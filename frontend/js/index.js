import "../css/style.css";

import Alpine from "alpinejs";

import { comparePage } from "./pages/compare.js";
import { eksternalPage } from "./pages/eksternal.js";
import { pivotPage } from "./pages/pivot.js";
import { ringkasanPage } from "./pages/ringkasan.js";
import { signinPage } from "./pages/signin.js";
import { targetPage } from "./pages/target.js";
import { transactionsPage } from "./pages/transactions.js";

// Mode gelap dipasang sebelum Alpine berjalan supaya halaman tidak berkedip terang dulu.
(function applyStoredTheme() {
  try {
    const stored = localStorage.getItem("darkMode");
    const isDark = stored !== null ? JSON.parse(stored) : false;
    document.documentElement.classList.toggle("dark", Boolean(isDark));
  } catch {
    document.documentElement.classList.remove("dark");
  }
})();

Alpine.data("pivotPage", pivotPage);
Alpine.data("transactionsPage", transactionsPage);
Alpine.data("eksternalPage", eksternalPage);
Alpine.data("ringkasanPage", ringkasanPage);
Alpine.data("comparePage", comparePage);
Alpine.data("targetPage", targetPage);
Alpine.data("signinPage", signinPage);

window.Alpine = Alpine;
Alpine.start();
