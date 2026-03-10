import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/caveat/400.css";
import "@fontsource/caveat/700.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/dancing-script/700.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import "@fontsource/merriweather/900.css";
import "@fontsource/patrick-hand/400.css";

import App from "./App";
import "./styles/theme.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
