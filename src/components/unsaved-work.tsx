import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { shouldConfirmDiscard, CLOSE_WARNING_PREFERENCE } from "@/lib/unsaved-work";

type Guard = {
  register: (id: string, dirty: boolean) => void;
  clearScope: (id: string) => void;
  confirmDiscard: (action: () => void, scope?: string) => void;
  requestAppClose: () => void;
};
const Context = createContext<Guard | null>(null);

export function UnsavedWorkProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(new Map<string, boolean>());
  const action = useRef<(() => void) | null>(null);
  const skipWarning = useRef(false);
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    try { skipWarning.current = localStorage.getItem(CLOSE_WARNING_PREFERENCE) === "true"; } catch { /* Storage is optional. */ }
  }, []);
  const register = useCallback((id: string, value: boolean) => { dirty.current.set(id, value); }, []);
  const clearScope = useCallback((id: string) => { dirty.current.delete(id); }, []);
  const confirmDiscard = useCallback((callback: () => void, scope?: string) => {
    // Repeated close gestures must not replace a confirmation already on screen.
    if (action.current) return;
    if (!shouldConfirmDiscard(dirty.current, skipWarning.current, scope)) { callback(); return; }
    action.current = callback;
    setDontShowAgain(false);
    setOpen(true);
  }, []);
  const requestAppClose = useCallback(() => {
    confirmDiscard(() => {
      if (isTauri()) void invoke("close_app").catch((reason) => setError(`Could not close the app: ${String(reason)}`));
    });
  }, [confirmDiscard]);

  useEffect(() => {
    if (isTauri()) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (shouldConfirmDiscard(dirty.current,skipWarning.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload",beforeUnload);
    return () => window.removeEventListener("beforeunload",beforeUnload);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<number>("app-close-requested", (event) => {
      // Acknowledge receipt immediately, before waiting for a user decision.
      void invoke("acknowledge_close_request", { requestId: event.payload }).catch((reason) => {
        setError(`Close confirmation could not be acknowledged: ${String(reason)}`);
      });
      requestAppClose();
    }).then(async (stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      // Native interception is enabled only after its JS listener exists.
      await invoke("set_close_guard_ready", { ready: true });
    }).catch((reason) => { if (!disposed) setError(`Close confirmation could not start: ${String(reason)}`); });
    return () => {
      disposed = true;
      unlisten?.();
      // Once enabled, interception remains armed for this process. A stale
      // cleanup from StrictMode/HMR must not disable a newer listener. Missing
      // listeners are handled by the native acknowledgement watchdog.
    };
  }, [requestAppClose]);

  const value = useMemo(() => ({ register, clearScope, confirmDiscard, requestAppClose }), [register, clearScope, confirmDiscard, requestAppClose]);
  const cancel = () => { action.current = null; setOpen(false); };
  const discard = () => {
    const callback = action.current;
    action.current = null;
    if (dontShowAgain) {
      skipWarning.current = true;
      try { localStorage.setItem(CLOSE_WARNING_PREFERENCE, "true"); } catch { /* This session still remembers the choice. */ }
    }
    setOpen(false);
    callback?.();
  };
  return <Context.Provider value={value}>
    {children}
    {error && <p role="alert" className="fixed bottom-4 left-4 rounded-md border bg-background p-3 text-sm">{error}</p>}
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) cancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved work?</AlertDialogTitle>
          <AlertDialogDescription>You have an open label or imported files with changes that have not been saved or exported. Close and discard this work?</AlertDialogDescription>
        </AlertDialogHeader>
        <Field orientation="horizontal">
          <Checkbox id="skip-close-warning" checked={dontShowAgain} onCheckedChange={(checked) => setDontShowAgain(checked === true)} />
          <FieldLabel htmlFor="skip-close-warning">Don’t show this warning again</FieldLabel>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancel}>Keep working</AlertDialogCancel>
          <AlertDialogAction onClick={discard}>Discard and close</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Context.Provider>;
}

export function useUnsavedWorkGuard(): Guard {
  const value = useContext(Context);
  if (!value) throw new Error("Unsaved work controls require UnsavedWorkProvider");
  return value;
}

export function useUnsavedWork(id: string, dirty: boolean): void {
  const { register, clearScope } = useUnsavedWorkGuard();
  useLayoutEffect(() => {
    register(id, dirty);
    return () => clearScope(id);
  }, [id, dirty, register, clearScope]);
}
