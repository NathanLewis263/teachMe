// Main uses query flags to pick the seal, controls, or overlay from this shared bundle.
import { createRoot } from "react-dom/client";
import { Pet } from "./pet";
import { TeacherControls } from "./teacher-controls";
import type { AppBridge } from "./teacher-types";
import { Overlay } from "./overlay";
declare global {
  interface Window {
    teachMe: AppBridge;
  }
}
const overlay = new URLSearchParams(location.search).has("overlay");
const pet = new URLSearchParams(location.search).has("pet");
document.body.style.background = overlay || pet ? "transparent" : "#f2f6f5";
createRoot(document.getElementById("root")!).render(
  overlay ? <Overlay /> : pet ? <Pet /> : <TeacherControls />,
);
