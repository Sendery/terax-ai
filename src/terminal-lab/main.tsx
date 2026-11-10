import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { ThemeProvider } from "@/modules/theme";
import { TerminalLabApp } from "@/terminal-lab/TerminalLabApp";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

ReactDOM.createRoot(
  document.getElementById("terminal-lab-root") as HTMLElement,
).render(
  <ThemeProvider>
    <TerminalLabApp />
  </ThemeProvider>,
);

// Created hidden like the other secondary windows; shown once React painted.
const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("terminal lab show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
