//! Serialized, bounded NIIMBOT transactions. The session owns its notification
//! stream; there is no spawned receiver, timer or background polling task.
//! Connect negotiation: https://printers.niim.blue/interfacing/proto/#connect
//! Legacy D110 wire sequence corroborated by MultiMote/niimbluelib D110PrintTask;
//! independently implemented protocol facts, no upstream source is included.
use crate::niimbot_protocol::{self as wire, Frame, Parser, Prepared};
use btleplug::api::{Characteristic, Peripheral as _, ValueNotification, WriteType};
use btleplug::platform::Peripheral;
use futures_util::{FutureExt, Stream, StreamExt};
use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::time::{timeout, Instant};

type IoFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
pub trait Io: Send {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, ()>;
    fn receive(&mut self) -> IoFuture<'_, Vec<u8>>;
    fn drain(&mut self);
}
pub struct BleIo {
    pub peripheral: Peripheral,
    pub write: Characteristic,
    pub notify: Characteristic,
    pub mode: WriteType,
    pub stream: Pin<Box<dyn Stream<Item = ValueNotification> + Send>>,
}
impl Io for BleIo {
    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, ()> {
        Box::pin(async move {
            self.peripheral
                .write(&self.write, bytes, self.mode)
                .await
                .map_err(|e| format!("NIIMBOT write: {e}"))
        })
    }
    fn receive(&mut self) -> IoFuture<'_, Vec<u8>> {
        Box::pin(async move {
            loop {
                match self.stream.next().await {
                    Some(event) if event.uuid == self.notify.uuid => return Ok(event.value),
                    Some(_) => {}
                    None => return Err("NIIMBOT disconnected while awaiting a response.".into()),
                }
            }
        })
    }
    fn drain(&mut self) {
        for _ in 0..64 {
            if !matches!(self.stream.next().now_or_never(), Some(Some(_))) {
                break;
            }
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum PrintTask {
    Legacy,
    B1,
}
pub struct Session<T: Io> {
    io: T,
    parser: Parser,
    valid: bool,
    pub history: VecDeque<Frame>,
    pub stock_code: Option<String>,
    pub connect_result: Option<u8>,
    pub protocol_version: Option<u8>,
    task: Option<PrintTask>,
    bytes: usize,
    chunks: usize,
}
impl<T: Io> Session<T> {
    pub fn new(io: T) -> Self {
        Self {
            io,
            parser: Parser::default(),
            valid: true,
            history: VecDeque::new(),
            stock_code: None,
            connect_result: None,
            protocol_version: None,
            task: None,
            bytes: 0,
            chunks: 0,
        }
    }
    async fn cancellable<R>(
        cancel: &AtomicBool,
        future: impl Future<Output = Result<R, String>>,
    ) -> Result<R, String> {
        tokio::pin!(future);
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(
                    "Printing cancelled; the job was not replayed. Reconnect before retrying."
                        .into(),
                );
            }
            tokio::select! { result=&mut future=>return result, _=tokio::time::sleep(Duration::from_millis(20))=>{} }
        }
    }
    async fn send(&mut self, bytes: &[u8], cancel: &AtomicBool) -> Result<(), String> {
        if !self.valid {
            return Err("NIIMBOT session is no longer valid. Reconnect.".into());
        }
        // Baseline 20-byte ATT payload, never inherit DB403's packet probing.
        for chunk in bytes.chunks(20) {
            Self::cancellable(cancel, async {
                timeout(Duration::from_secs(5), self.io.write(chunk))
                    .await
                    .map_err(|_| "NIIMBOT write timed out; acceptance is uncertain.".to_string())?
            })
            .await?;
            self.bytes += chunk.len();
            self.chunks += 1;
            Self::cancellable(cancel, async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                Ok(())
            })
            .await?;
        }
        Ok(())
    }
    async fn transact(
        &mut self,
        bytes: &[u8],
        expected: u8,
        optional: bool,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>, String> {
        // Register response identity before writing. Sequential ownership prevents
        // overlapping waiters. Drop stale queued bytes before the new request.
        let waiting_for = expected;
        self.io.drain();
        self.parser.clear();
        self.send(bytes, cancel).await?;
        let deadline = Instant::now()
            + if optional {
                Duration::from_millis(600)
            } else {
                Duration::from_secs(8)
            };
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let received = Self::cancellable(cancel, async {
                timeout(remaining, self.io.receive()).await.map_err(|_| {
                    format!("NIIMBOT response {expected:02X} timed out; no job was replayed.")
                })?
            })
            .await;
            let bytes = match received {
                Ok(bytes) => bytes,
                Err(error) if optional && error.contains("timed out") => return Ok(Vec::new()),
                Err(error) => return Err(error),
            };
            for frame in self.parser.feed(&bytes) {
                if self.history.len() == 32 {
                    self.history.pop_front();
                }
                self.history.push_back(frame.clone());
                if frame.command == waiting_for {
                    return Ok(frame.data);
                }
                if frame.command == 0 && optional {
                    return Ok(Vec::new());
                }
                if frame.command == 0 {
                    return Err("The printer rejected the NIIMBOT command.".into());
                }
            }
        }
    }
    pub async fn request(
        &mut self,
        command: u8,
        data: &[u8],
        expected: u8,
        optional: bool,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>, String> {
        let result = self
            .transact(&wire::frame(command, data), expected, optional, cancel)
            .await;
        if result.is_err() {
            self.valid = false;
        }
        result
    }
    pub async fn initialize(&mut self, cancel: &AtomicBool) -> Result<(), String> {
        let result=async {
            let connected=self.transact(wire::CONNECT,0xc2,false,cancel).await?;
            if connected.len()!=1 || ![1,2,3].contains(&connected[0]) {return Err("NIIMBOT connection was rejected or its response was invalid.".into());}
            self.connect_result=Some(connected[0]);
            tokio::time::sleep(Duration::from_millis(100)).await;
            let status=self.request(0xa5,&[1],0xb5,false,cancel).await?;
            self.protocol_version=match connected[0] {
                1=>Some(0),2=>Some(1),_ if status.len()>=13=>{
                    let version=status[11] as u16*100+status[12] as u16;
                    match version {204..=299=>Some(3),300..=301=>Some(4),302.. =>Some(5),_=>None}
                },_=>None
            };
            let model=self.request(0x40,&[8],0x48,false,cancel).await?;
            if wire::model_id(&model)?!=2304 {return Err("Only the original NIIMBOT D110 (model 2304) is supported experimentally. No print data was sent.".into());}
            for sub in [0x0b,0x0d,0x0a,0x07,0x03,0x0c,0x09] {self.request(0x40,&[sub],0x40+sub,true,cancel).await?;}
            self.request(0xdc,&[4],0xd9,true,cancel).await?;
            let rfid=self.request(0x1a,&[1],0x1b,true,cancel).await?;
            self.stock_code=wire::stock_code(&rfid);
            let contradictory_status=status.len()>=13 && status[11] as u16*100+status[12] as u16>=204;
            self.task=match (connected[0],self.protocol_version) {(2,Some(1)) if !contradictory_status=>Some(PrintTask::Legacy),(3,Some(3))=>Some(PrintTask::B1),_=>None};
            Ok(())
        }.await;
        if result.is_err() {
            self.valid = false;
        }
        result
    }
    pub fn supports_printing(&self) -> bool {
        self.valid && self.task.is_some()
    }
    pub async fn print(
        &mut self,
        job: &Prepared,
        cancel: &AtomicBool,
        progress: impl Fn(usize, usize),
    ) -> Result<(usize, usize), String> {
        let task=self.task.ok_or("This D110 session has no verified print task for its negotiated protocol. No print data was sent.")?;
        // Construct the complete task-specific row representation before any
        // density/start/page command; legacy firmware uses three 32-dot counts.
        let rows = if task == PrintTask::Legacy {
            wire::legacy_rows(&job.rows)?
        } else {
            job.rows.clone()
        };
        self.bytes = 0;
        self.chunks = 0;
        let result=async {
            for copy in 0..job.copies {
                self.request(0x21,&[job.density],0x31,false,cancel).await.and_then(ack)?;
                self.request(0x23,&[1],0x33,false,cancel).await.and_then(ack)?;
                let start:&[u8]=if task==PrintTask::Legacy {&[1]} else {&[0,1,0,0,0,0,0]};
                self.request(1,start,2,false,cancel).await.and_then(ack)?;
                if task==PrintTask::Legacy {self.request(0x20,&[1],0x30,false,cancel).await.and_then(ack)?;}
                self.request(3,&[1],4,false,cancel).await.and_then(ack)?;
                let mut size=(job.height as u16).to_be_bytes().to_vec();size.extend((job.width as u16).to_be_bytes());
                if task==PrintTask::B1 {size.extend([0,1]);}
                self.request(0x13,&size,0x14,false,cancel).await.and_then(ack)?;
                if task==PrintTask::Legacy {self.request(0x15,&[0,1],0x16,false,cancel).await.and_then(ack)?;}
                for (index,row) in rows.iter().enumerate(){self.send(row,cancel).await?;progress(copy as usize*(rows.len()+1)+index+1,job.copies as usize*(rows.len()+1));}
                self.request(0xe3,&[1],0xe4,false,cancel).await.and_then(ack)?;
                let deadline=Instant::now()+Duration::from_secs(30);
                loop {
                    let status=self.request(0xa3,&[1],0xb3,false,cancel).await?;
                    if wire::completed_page(&status)? >= 1 && status[2]==100 && status[3]==100 {break;}
                    if Instant::now()>=deadline {return Err("D110 did not confirm physical print completion. The job was not replayed.".into());}
                    Self::cancellable(cancel,async {tokio::time::sleep(Duration::from_millis(100)).await;Ok(())}).await?;
                }
                self.request(0xf3,&[1],0xf4,false,cancel).await.and_then(ack)?;
                progress((copy as usize+1)*(job.rows.len()+1),job.copies as usize*(job.rows.len()+1));
            }
            Ok((self.bytes,self.chunks))
        }.await;
        if result.is_err() {
            self.valid = false;
        }
        result
    }
}
fn ack(data: Vec<u8>) -> Result<(), String> {
    if data.as_slice() == [1] {
        Ok(())
    } else {
        Err("NIIMBOT did not acknowledge the operation; print completion is uncertain.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    fn session(replies: Vec<Vec<u8>>) -> Session<Fake> {
        let mut session = Session::new(Fake {
            incoming: replies.into(),
            writes: Vec::new(),
        });
        session.task = Some(PrintTask::B1);
        session
    }
    fn written(s: &Session<Fake>) -> Vec<Frame> {
        let mut parser = Parser::default();
        s.io.writes
            .iter()
            .flat_map(|bytes| parser.feed(bytes))
            .collect()
    }
    fn print_replies() -> Vec<Vec<u8>> {
        vec![
            wire::frame(0x31, &[1]),
            wire::frame(0x33, &[1]),
            wire::frame(2, &[1]),
            wire::frame(4, &[1]),
            wire::frame(0x14, &[1]),
            wire::frame(0xe4, &[1]),
            wire::frame(0xb3, &[0, 1, 90, 50]),
            wire::frame(0xb3, &[0, 1, 100, 100]),
            wire::frame(0xf4, &[1]),
        ]
    }
    fn prepared() -> Prepared {
        Prepared {
            width: 96,
            height: 240,
            rows: vec![
                wire::frame(0x84, &[0, 0, 200]),
                wire::frame(0x84, &[0, 200, 40]),
            ],
            density: 2,
            copies: 2,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn two_copies_are_complete_separate_jobs_and_progress_waits() {
        let mut replies = print_replies();
        replies.extend(print_replies());
        let mut s = session(replies);
        let progress = RefCell::new(Vec::new());
        s.print(&prepared(), &AtomicBool::new(false), |sent, total| {
            progress.borrow_mut().push((sent, total))
        })
        .await
        .unwrap();
        let frames = written(&s);
        let commands: Vec<_> = frames.iter().map(|f| f.command).collect();
        let one = vec![0x21, 0x23, 1, 3, 0x13, 0x84, 0x84, 0xe3, 0xa3, 0xa3, 0xf3];
        let mut expected = one.clone();
        expected.extend(one);
        assert_eq!(commands, expected);
        assert_eq!(frames[2].data, [0, 1, 0, 0, 0, 0, 0]);
        assert_eq!(frames[4].data, [0, 240, 0, 96, 0, 1]);
        assert_eq!(progress.borrow().last(), Some(&(6, 6)));
        assert_eq!(progress.borrow().iter().filter(|(s, t)| s == t).count(), 1);
    }
    #[tokio::test(start_paused = true)]
    async fn initialization_is_read_only_and_accepts_short_model_reply() {
        let mut replies = vec![
            wire::frame(0xc2, &[1]),
            wire::frame(0xb5, &[1]),
            wire::frame(0x48, &[9]),
        ];
        for sub in [0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09] {
            replies.push(wire::frame(0x40 + sub, &[0]));
        }
        replies.push(wire::frame(0xd9, &[1]));
        let mut s = session(replies);
        s.initialize(&AtomicBool::new(false)).await.unwrap();
        assert!(written(&s)
            .iter()
            .all(|f| [0xc1, 0xa5, 0x40, 0xdc, 0x1a].contains(&f.command)));
        let mut wrong = session(vec![
            wire::frame(0xc2, &[1]),
            wire::frame(0xb5, &[1]),
            wire::frame(0x48, &[9, 1]),
        ]);
        assert!(wrong.initialize(&AtomicBool::new(false)).await.is_err());
        assert!(!wrong.valid);
    }
    #[tokio::test(start_paused = true)]
    async fn protocol_revision_vectors_match_browser() {
        for (version, accepted) in [
            (0, false),
            (203, false),
            (204, true),
            (299, true),
            (300, false),
            (302, false),
        ] {
            let mut status = vec![0; 13];
            status[11] = (version / 100) as u8;
            status[12] = (version % 100) as u8;
            let mut replies = vec![
                wire::frame(0xc2, &[3]),
                wire::frame(0xb5, &status),
                wire::frame(0x48, &[9, 0]),
            ];
            for sub in [0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09] {
                replies.push(wire::frame(0x40 + sub, &[0]));
            }
            replies.push(wire::frame(0xd9, &[1]));
            let mut s = session(replies);
            s.initialize(&AtomicBool::new(false)).await.unwrap();
            assert_eq!(s.supports_printing(), accepted, "version{version}");
        }
    }
    #[tokio::test(start_paused = true)]
    async fn legacy_enum_and_unsupported_heartbeat_are_not_boolean_acks() {
        for code in [1, 2, 3] {
            let mut replies = vec![
                wire::frame(0xc2, &[code]),
                wire::frame(0xb5, b"00"),
                wire::frame(0x48, &[9, 0]),
            ];
            for sub in [0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09] {
                replies.push(wire::frame(0x40 + sub, &[0]));
            }
            replies.push(wire::frame(0, &[1]));
            replies.push(wire::frame(0x1b, &[0]));
            let mut s = session(replies);
            s.initialize(&AtomicBool::new(false)).await.unwrap();
            assert_eq!(s.connect_result, Some(code));
            assert_eq!(s.supports_printing(), code == 2);
            assert!(s.history.iter().any(|f| f.command == 0 && f.data == [1]));
            if code != 2 {
                assert!(s
                    .print(&prepared(), &AtomicBool::new(false), |_, _| {})
                    .await
                    .is_err());
            }
        }
        for data in [vec![0], vec![0x5a], vec![4], vec![2, 1], vec![]] {
            let mut s = session(vec![wire::frame(0xc2, &data)]);
            assert!(s.initialize(&AtomicBool::new(false)).await.is_err());
            assert!(!s.valid);
        }
    }
    #[tokio::test(start_paused = true)]
    async fn legacy_copies_have_exact_four_byte_size_and_quantity_flow() {
        let mut replies = Vec::new();
        for _ in 0..2 {
            for command in [0x31, 0x33, 2, 0x30, 4, 0x14, 0x16, 0xe4] {
                replies.push(wire::frame(command, &[1]));
            }
            replies.push(wire::frame(0xb3, &[0, 1, 100, 100]));
            replies.push(wire::frame(0xf4, &[1]));
        }
        let mut s = session(replies);
        s.task = Some(PrintTask::Legacy);
        s.print(&prepared(), &AtomicBool::new(false), |_, _| {})
            .await
            .unwrap();
        let frames = written(&s);
        let once = vec![
            0x21, 0x23, 1, 0x20, 3, 0x13, 0x15, 0x84, 0x84, 0xe3, 0xa3, 0xf3,
        ];
        let mut expected = once.clone();
        expected.extend(once);
        assert_eq!(
            frames.iter().map(|f| f.command).collect::<Vec<_>>(),
            expected
        );
        assert_eq!(frames[2].data, [1]);
        assert_eq!(frames[5].data, [0, 240, 0, 96]);
        assert_eq!(frames[6].data, [0, 1]);
    }
    #[tokio::test(start_paused = true)]
    async fn full_width_page_preserves_edge_pixels() {
        let mut replies = Vec::new();
        for command in [0x31, 0x33, 2, 0x30, 4, 0x14, 0x16, 0xe4] {
            replies.push(wire::frame(command, &[1]));
        }
        replies.push(wire::frame(0xb3, &[0, 1, 100, 100]));
        replies.push(wire::frame(0xf4, &[1]));
        let mut s = session(replies);
        s.task = Some(PrintTask::Legacy);
        let mut page = prepared();
        page.width = 120;
        page.copies = 1;
        let mut edge = vec![0, 0, 0, 2, 0, 1];
        edge.extend([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
        page.rows = vec![
            wire::frame(0x85, &edge),
            wire::frame(0x84, &[0, 1, 200]),
            wire::frame(0x84, &[0, 201, 39]),
        ];
        s.print(&page, &AtomicBool::new(false), |_, _| {})
            .await
            .unwrap();
        let frames = written(&s);
        assert_eq!(frames[5].data, [0, 240, 0, 120]);
        let row = frames.iter().find(|frame| frame.command == 0x85).unwrap();
        assert_eq!(&row.data[..6], &[0, 0, 1, 0, 1, 1]);
        assert_eq!(row.data.len(), 21);
        assert_eq!(row.data[6], 128);
        assert_eq!(row.data[20], 1);
    }
    #[tokio::test(start_paused = true)]
    async fn contradictory_new_status_does_not_authorize_legacy_printing() {
        let mut status = vec![0; 13];
        status[11] = 2;
        status[12] = 4;
        let mut replies = vec![
            wire::frame(0xc2, &[2]),
            wire::frame(0xb5, &status),
            wire::frame(0x48, &[9, 0]),
        ];
        for sub in [0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09] {
            replies.push(wire::frame(0x40 + sub, &[0]));
        }
        replies.push(wire::frame(0, &[1]));
        let mut s = session(replies);
        s.initialize(&AtomicBool::new(false)).await.unwrap();
        assert_eq!(s.protocol_version, Some(1));
        assert!(!s.supports_printing());
    }
    #[tokio::test(start_paused = true)]
    async fn rfid_is_optional_and_only_stock_code_is_exposed() {
        let mut valid = vec![0; 8];
        valid.push(8);
        valid.extend(b"02282280");
        valid.push(14);
        valid.extend(b"SANITIZED00000");
        valid.extend([0, 120, 0, 3, 1, 0, 100]);
        for (rfid, expected) in [
            (valid, Some("02282280".into())),
            (vec![0], None),
            (vec![0; 9], None),
        ] {
            let mut replies = vec![
                wire::frame(0xc2, &[1]),
                wire::frame(0xb5, &[1]),
                wire::frame(0x48, &[9, 0]),
            ];
            for sub in [0x0b, 0x0d, 0x0a, 0x07, 0x03, 0x0c, 0x09] {
                replies.push(wire::frame(0x40 + sub, &[0]));
            }
            replies.push(wire::frame(0xd9, &[1]));
            replies.push(wire::frame(0x1b, &rfid));
            let mut s = session(replies);
            s.initialize(&AtomicBool::new(false)).await.unwrap();
            assert_eq!(s.stock_code, expected);
            assert!(s.valid);
            assert!(s
                .history
                .iter()
                .any(|frame| frame.command == 0x1b && frame.data == rfid));
            assert_eq!(
                written(&s).last().unwrap(),
                &Frame {
                    command: 0x1a,
                    data: vec![1]
                }
            );
        }
    }
    #[tokio::test(start_paused = true)]
    async fn failed_setup_and_cancelled_ack_never_send_rows_or_end() {
        let mut s = session(vec![wire::frame(0x31, &[0])]);
        assert!(s
            .print(&prepared(), &AtomicBool::new(false), |_, _| {})
            .await
            .is_err());
        assert_eq!(
            written(&s).iter().map(|f| f.command).collect::<Vec<_>>(),
            [0x21]
        );
        let mut s = session(Vec::new());
        let cancel = AtomicBool::new(false);
        let (result, ()) = tokio::join!(s.request(0xe3, &[1], 0xe4, false, &cancel), async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            cancel.store(true, Ordering::SeqCst);
        });
        assert!(result.is_err());
        assert!(!s.valid);
        assert_eq!(written(&s).len(), 1);
        // Dropping an awaited session has no receiver task to outlive it.
        drop(s);
    }
    #[tokio::test(start_paused = true)]
    async fn malformed_status_prevents_end_and_is_not_retried() {
        let mut replies = print_replies();
        replies[6] = wire::frame(0xb3, &[0, 1]);
        let mut s = session(replies);
        assert!(s
            .print(&prepared(), &AtomicBool::new(false), |_, _| {})
            .await
            .is_err());
        assert!(!written(&s).iter().any(|frame| frame.command == 0xf3));
        assert!(!s.valid);
    }
    struct Fake {
        incoming: VecDeque<Vec<u8>>,
        writes: Vec<Vec<u8>>,
    }
    impl Io for Fake {
        fn write<'a>(&'a mut self, b: &'a [u8]) -> IoFuture<'a, ()> {
            self.writes.push(b.to_vec());
            Box::pin(async { Ok(()) })
        }
        fn receive(&mut self) -> IoFuture<'_, Vec<u8>> {
            let next = self.incoming.pop_front();
            Box::pin(async move {
                match next {
                    Some(bytes) => Ok(bytes),
                    None => std::future::pending().await,
                }
            })
        }
        fn drain(&mut self) {}
    }
    #[tokio::test(start_paused = true)]
    async fn timeout_cancel_and_unsolicited() {
        let cancel = AtomicBool::new(false);
        let mut s = Session::new(Fake {
            incoming: VecDeque::from([wire::frame(0xd3, &[1]), wire::frame(0x48, &[9, 0])]),
            writes: Vec::new(),
        });
        assert_eq!(
            s.request(0x40, &[8], 0x48, false, &cancel).await.unwrap(),
            [9, 0]
        );
        assert!(s.request(0x40, &[8], 0x48, false, &cancel).await.is_err());
        assert!(!s.valid);
        let count = s.io.writes.len();
        assert!(s.request(0x40, &[8], 0x48, false, &cancel).await.is_err());
        assert_eq!(s.io.writes.len(), count);
        let mut s = Session::new(Fake {
            incoming: VecDeque::new(),
            writes: Vec::new(),
        });
        cancel.store(true, Ordering::SeqCst);
        assert!(s.request(0x40, &[8], 0x48, false, &cancel).await.is_err());
        assert!(s.io.writes.is_empty());
    }
}
