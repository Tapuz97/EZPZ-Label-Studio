use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Notify;

/// A one-way lifecycle barrier shared by IPC operations and the exit handler.
#[derive(Default)]
pub struct Shutdown {
    requested: AtomicBool,
    complete: AtomicBool,
    notification: Notify,
}

impl Shutdown {
    pub fn request(&self) -> bool {
        if self.requested.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.notification.notify_waiters();
        true
    }
    pub fn is_requested(&self) -> bool {
        self.requested.load(Ordering::SeqCst)
    }
    pub fn is_complete(&self) -> bool {
        self.complete.load(Ordering::SeqCst)
    }
    pub fn finish(&self) {
        self.complete.store(true, Ordering::SeqCst);
    }

    async fn cancelled(&self) {
        // Register before checking the flag so a close request cannot be lost
        // between checking state and starting to wait for its notification.
        let notification = self.notification.notified();
        tokio::pin!(notification);
        notification.as_mut().enable();
        if self.is_requested() {
            return;
        }
        notification.await;
    }

    pub async fn while_running<T>(
        &self,
        operation: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        tokio::select! {
            biased;
            _ = self.cancelled() => Err("The application is closing.".into()),
            result = operation => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[tokio::test]
    async fn closing_rejects_new_work_without_polling_it() {
        let shutdown = Shutdown::default();
        assert!(shutdown.request());
        let result = shutdown
            .while_running(async {
                panic!("new work must not run");
                #[allow(unreachable_code)]
                Ok::<_, String>(())
            })
            .await;
        assert!(result.is_err());
        assert!(!shutdown.request());
        shutdown.finish();
        assert!(shutdown.is_complete());
    }

    #[tokio::test]
    async fn closing_drops_inflight_work_and_releases_its_mutex() {
        let shutdown = Arc::new(Shutdown::default());
        let resource = Arc::new(Mutex::new(()));
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let worker_shutdown = shutdown.clone();
        let worker_resource = resource.clone();
        let worker = tokio::spawn(async move {
            worker_shutdown
                .while_running(async {
                    let _guard = worker_resource.lock().await;
                    let _ = entered_tx.send(());
                    std::future::pending::<Result<(), String>>().await
                })
                .await
        });
        entered_rx.await.unwrap();
        shutdown.request();
        assert!(worker.await.unwrap().is_err());
        assert!(resource.try_lock().is_ok());
    }

    #[tokio::test]
    async fn close_racing_initial_poll_never_leaves_a_waiter_stuck() {
        for _ in 0..100 {
            let shutdown = Arc::new(Shutdown::default());
            let worker_shutdown = shutdown.clone();
            let worker = tokio::spawn(async move {
                worker_shutdown
                    .while_running(std::future::pending::<Result<(), String>>())
                    .await
            });
            shutdown.request();
            assert!(
                tokio::time::timeout(std::time::Duration::from_secs(1), worker)
                    .await
                    .unwrap()
                    .unwrap()
                    .is_err()
            );
        }
    }
}
