import React from "react";
import ReactDOM from "react-dom/client";
import { lazy, Suspense } from "react";
import { StartupScreen } from "./StartupScreen";
import { TitleBar } from "./components/title-bar";
import { UnsavedWorkProvider } from "./components/unsaved-work";
import "./styles.css";
const App = lazy(() => import("./App"));
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UnsavedWorkProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <TitleBar />
        <div className="min-h-0 flex-1">
          <Suspense fallback={<StartupScreen />}>
            <App />
          </Suspense>
        </div>
      </div>
    </UnsavedWorkProvider>
  </React.StrictMode>,
);
