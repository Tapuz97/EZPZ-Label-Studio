//! Sequential BLE transfer scheduling, independent of device discovery.
//!
//! An ATT acknowledgement is transport acceptance, not consumption by the
//! printer's UART/print engine. The host ceiling below is a conservative design
//! limit, not a measured baud rate or a claim about printer-buffer capacity.
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::time::{sleep_until, timeout_at, Instant};

pub const BASELINE_CHUNK: usize = 20;
pub const MAX_CHUNK: usize = 244;
pub const ACKNOWLEDGED_HOST_CEILING: u32 = 8 * 1024;
pub const MAX_TRANSFER_BYTES: usize = 1_048_576;

#[derive(Clone, Debug)]
pub struct TransferPolicy {
    pub chunk_size: usize,
    pub acknowledged: bool,
    pub host_rate_limit_bps: Option<u32>,
    pub minimum_gap: Duration,
}

impl TransferPolicy {
    pub fn for_link(acknowledged: bool, mtu: Option<u16>) -> Self {
        if acknowledged {
            Self {
                chunk_size: valid_mtu(mtu)
                    .map_or(BASELINE_CHUNK, |mtu| usize::from(mtu - 3).min(MAX_CHUNK)),
                acknowledged,
                host_rate_limit_bps: Some(ACKNOWLEDGED_HOST_CEILING),
                minimum_gap: Duration::ZERO,
            }
        } else {
            // No tested printer-level flow control: retain the original bounded
            // stream on characteristics that cannot acknowledge writes.
            Self {
                chunk_size: BASELINE_CHUNK,
                acknowledged,
                host_rate_limit_bps: None,
                minimum_gap: Duration::from_millis(10),
            }
        }
    }

    /// Offline comparison with the previous implementation; never selected by
    /// the native connection path.
    pub fn legacy_baseline() -> Self {
        Self {
            chunk_size: BASELINE_CHUNK,
            acknowledged: true,
            host_rate_limit_bps: None,
            minimum_gap: Duration::from_millis(10),
        }
    }
}

pub fn valid_mtu(mtu: Option<u16>) -> Option<u16> {
    mtu.filter(|value| (23..=517).contains(value))
}

pub trait ChunkWriter {
    fn write<'a>(
        &'a mut self,
        bytes: &'a [u8],
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

#[derive(Clone, Debug, Default)]
pub struct TransferStats {
    pub bytes_sent: usize,
    pub chunks_sent: usize,
    pub elapsed_ms: u64,
    pub bytes_per_second: f64,
}

#[derive(Clone, Debug)]
pub struct TransferFailure {
    pub message: String,
    pub stats: TransferStats,
    pub last_write_uncertain: bool,
}

fn update_timing(stats: &mut TransferStats, started: Instant) {
    let elapsed = started.elapsed();
    stats.elapsed_ms = elapsed.as_millis().min(u64::MAX as u128) as u64;
    stats.bytes_per_second = if elapsed.is_zero() {
        0.0
    } else {
        stats.bytes_sent as f64 / elapsed.as_secs_f64()
    };
}

fn failure(
    message: String,
    mut stats: TransferStats,
    started: Instant,
    uncertain: bool,
) -> TransferFailure {
    update_timing(&mut stats, started);
    TransferFailure {
        message,
        stats,
        last_write_uncertain: uncertain,
    }
}

pub async fn transfer_bytes(
    writer: &mut impl ChunkWriter,
    bytes: &[u8],
    policy: &TransferPolicy,
    cancel: &AtomicBool,
    progress: impl Fn(usize, usize),
) -> Result<TransferStats, TransferFailure> {
    let started = Instant::now();
    let mut stats = TransferStats::default();
    if bytes.is_empty()
        || bytes.len() > MAX_TRANSFER_BYTES
        || !(1..=MAX_CHUNK).contains(&policy.chunk_size)
        || policy.host_rate_limit_bps == Some(0)
        || (!policy.acknowledged
            && (policy.chunk_size > BASELINE_CHUNK
                || policy.minimum_gap < Duration::from_millis(10)))
    {
        return Err(failure(
            "Invalid transfer size or chunk policy".into(),
            stats,
            started,
            false,
        ));
    }
    let deadline = started + Duration::from_secs(600);
    let mut next_write = started;
    let mut last_progress = started;
    progress(0, bytes.len());
    for chunk in bytes.chunks(policy.chunk_size) {
        if cancel.load(Ordering::Relaxed) {
            return Err(failure(
                "Transfer cancelled; already buffered labels may still print".into(),
                stats,
                started,
                false,
            ));
        }
        if Instant::now() < next_write {
            sleep_until(next_write.min(deadline)).await;
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(failure(
                "Transfer cancelled; already buffered labels may still print".into(),
                stats,
                started,
                false,
            ));
        }
        if Instant::now() >= deadline {
            return Err(failure(
                "Print transfer exceeded ten minutes".into(),
                stats,
                started,
                false,
            ));
        }
        let write_started = Instant::now();
        // Exactly one write is outstanding. Never retry a failed/uncertain chunk.
        let write_deadline = (write_started + Duration::from_secs(10)).min(deadline);
        match timeout_at(write_deadline, writer.write(chunk)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(failure(error, stats, started, true)),
            Err(_) => {
                return Err(failure(
                    "Bluetooth write timed out".into(),
                    stats,
                    started,
                    true,
                ))
            }
        }
        stats.bytes_sent += chunk.len();
        stats.chunks_sent += 1;
        let now = Instant::now();
        if now.duration_since(last_progress) >= Duration::from_millis(100)
            && stats.bytes_sent != bytes.len()
        {
            progress(stats.bytes_sent, bytes.len());
            last_progress = now;
        }
        // Per-packet schedule: no token bank and no catch-up burst after a slow
        // acknowledgement. ACK latency counts toward the host rate ceiling.
        let rate_deadline = policy.host_rate_limit_bps.map_or(write_started, |rate| {
            write_started + Duration::from_secs_f64(chunk.len() as f64 / f64::from(rate))
        });
        next_write = rate_deadline.max(now + policy.minimum_gap);
    }
    // Account for the final packet's host-rate budget too. This keeps a series
    // of short jobs from bypassing the ceiling by resetting a first-packet burst.
    if policy.host_rate_limit_bps.is_some() && Instant::now() < next_write {
        sleep_until(next_write).await;
    }
    update_timing(&mut stats, started);
    progress(stats.bytes_sent, bytes.len());
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct MockWriter {
        delay: Duration,
        writes: Vec<Vec<u8>>,
        starts: Vec<Instant>,
        fail_at: Option<usize>,
        cancel_after: Option<(usize, Arc<AtomicBool>)>,
    }
    impl MockWriter {
        fn new(delay_ms: u64) -> Self {
            Self {
                delay: Duration::from_millis(delay_ms),
                writes: vec![],
                starts: vec![],
                fail_at: None,
                cancel_after: None,
            }
        }
    }
    impl ChunkWriter for MockWriter {
        fn write<'a>(
            &'a mut self,
            bytes: &'a [u8],
        ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
            Box::pin(async move {
                self.starts.push(Instant::now());
                self.writes.push(bytes.to_vec());
                tokio::time::sleep(self.delay).await;
                if self.fail_at == Some(self.writes.len()) {
                    return Err("Simulated write failure".into());
                }
                if let Some((count, flag)) = &self.cancel_after {
                    if self.writes.len() == *count {
                        flag.store(true, Ordering::Relaxed);
                    }
                }
                Ok(())
            })
        }
    }

    #[test]
    fn chunk_size_uses_only_bounded_reported_mtu() {
        for mtu in [None, Some(0), Some(22), Some(65535)] {
            assert_eq!(TransferPolicy::for_link(true, mtu).chunk_size, 20);
        }
        assert_eq!(TransferPolicy::for_link(true, Some(23)).chunk_size, 20);
        assert_eq!(TransferPolicy::for_link(true, Some(100)).chunk_size, 97);
        assert_eq!(TransferPolicy::for_link(true, Some(247)).chunk_size, 244);
        assert_eq!(TransferPolicy::for_link(true, Some(517)).chunk_size, 244);
        let unacknowledged = TransferPolicy::for_link(false, Some(247));
        assert_eq!(unacknowledged.chunk_size, 20);
        assert_eq!(unacknowledged.minimum_gap, Duration::from_millis(10));
    }

    #[tokio::test(start_paused = true)]
    async fn acknowledged_baseline_removes_redundant_post_ack_sleep() {
        let data = vec![42; 200];
        let mut old = MockWriter::new(5);
        let old_stats = transfer_bytes(
            &mut old,
            &data,
            &TransferPolicy::legacy_baseline(),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap();
        let mut new = MockWriter::new(5);
        let stats = transfer_bytes(
            &mut new,
            &data,
            &TransferPolicy::for_link(true, None),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(old_stats.elapsed_ms, 140);
        assert_eq!(stats.elapsed_ms, 50);
        assert_eq!(new.writes, old.writes);
    }

    #[tokio::test(start_paused = true)]
    async fn larger_packets_are_serial_bounded_and_rate_limited() {
        let data: Vec<u8> = (0..1000).map(|i| (i % 251) as u8).collect();
        let mut writer = MockWriter::new(1);
        let stats = transfer_bytes(
            &mut writer,
            &data,
            &TransferPolicy::for_link(true, Some(247)),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(stats.chunks_sent, 5);
        assert!(stats.bytes_per_second <= f64::from(ACKNOWLEDGED_HOST_CEILING));
        assert!(writer.writes.iter().all(|chunk| chunk.len() <= 244));
        assert_eq!(writer.writes.concat(), data);
        for pair in writer.starts.windows(2) {
            assert!(pair[1].duration_since(pair[0]) >= Duration::from_secs_f64(244.0 / 8192.0));
        }
    }

    #[tokio::test(start_paused = true)]
    async fn unacknowledged_device_keeps_original_pacing() {
        let mut writer = MockWriter::new(5);
        let stats = transfer_bytes(
            &mut writer,
            &[0; 200],
            &TransferPolicy::for_link(false, Some(247)),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(stats.chunks_sent, 10);
        assert_eq!(stats.elapsed_ms, 140);
    }

    #[tokio::test(start_paused = true)]
    async fn failed_chunk_is_not_counted_or_replayed() {
        let mut writer = MockWriter::new(1);
        writer.fail_at = Some(2);
        let failure = transfer_bytes(
            &mut writer,
            &[0; 1000],
            &TransferPolicy::for_link(true, Some(247)),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(failure.stats.bytes_sent, 244);
        assert_eq!(writer.writes.len(), 2);
        assert!(failure.last_write_uncertain);
    }

    #[tokio::test(start_paused = true)]
    async fn cancellation_prevents_later_writes() {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut writer = MockWriter::new(1);
        writer.cancel_after = Some((2, cancel.clone()));
        let failure = transfer_bytes(
            &mut writer,
            &[0; 1000],
            &TransferPolicy::for_link(true, Some(247)),
            &cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(failure.stats.bytes_sent, 488);
        assert_eq!(writer.writes.len(), 2);
        assert!(!failure.last_write_uncertain);
    }

    #[tokio::test(start_paused = true)]
    async fn timed_out_write_is_uncertain_and_never_retried() {
        let mut writer = MockWriter::new(20_000);
        let failure = transfer_bytes(
            &mut writer,
            &[0; 40],
            &TransferPolicy::for_link(true, None),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(failure.stats.bytes_sent, 0);
        assert_eq!(writer.writes.len(), 1);
        assert_eq!(failure.stats.elapsed_ms, 10_000);
        assert!(failure.last_write_uncertain);
    }

    #[tokio::test(start_paused = true)]
    async fn progress_is_time_throttled_with_final_update_for_non_round_chunks() {
        let updates = Arc::new(Mutex::new(Vec::new()));
        let output = updates.clone();
        let mut writer = MockWriter::new(5);
        transfer_bytes(
            &mut writer,
            &[0; 5000],
            &TransferPolicy::for_link(true, Some(247)),
            &AtomicBool::new(false),
            move |sent, total| output.lock().unwrap().push((sent, total)),
        )
        .await
        .unwrap();
        let updates = updates.lock().unwrap();
        assert_eq!(updates.first(), Some(&(0, 5000)));
        assert_eq!(updates.last(), Some(&(5000, 5000)));
        assert!(updates.len() > 2 && updates.len() < writer.writes.len());
    }
}
