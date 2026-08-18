import { mount } from "svelte";
import { initBolt } from "../lib/utils/bolt";
import "../index.scss";
import App from "./App.svelte";

initBolt();

mount(App, {
  target: document.getElementById("app") as HTMLElement,
});
