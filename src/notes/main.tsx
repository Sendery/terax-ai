import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "../styles/globals.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { ThemeProvider } from "@/modules/theme";
import { NotesWindowApp } from "./NotesWindowApp";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

ReactDOM.createRoot(
  document.getElementById("notes-root") as HTMLElement,
).render(
  <ThemeProvider>
    <NotesWindowApp />
  </ThemeProvider>,
);

// The window is created hidden (visible:false) to avoid a flash; show it once
// React has painted.
const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("notes show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
