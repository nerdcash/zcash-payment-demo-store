const body = document.body;
const pollUrl = body.dataset.poll;
const receivedEl = document.querySelector("[data-received]");
const paidAmountEl = document.querySelector("[data-paid-amount]");
const watchEl = document.querySelector("[data-watch]");
const copyButton = document.querySelector("[data-copy]");
const address = document.querySelector("[data-address]")?.textContent?.trim() ?? "";

if (copyButton) {
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1600);
    } catch {
      copyButton.textContent = "Select the address";
    }
  });
}

let lastStatus = body.dataset.status ?? "";

async function tick() {
  if (!pollUrl) return;
  try {
    const response = await fetch(pollUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return;
    const order = await response.json();
    if (receivedEl) receivedEl.textContent = order.received;
    if (paidAmountEl) paidAmountEl.textContent = order.received;
    body.dataset.status = order.status;
    if (watchEl) {
      if (order.status === "paid") watchEl.textContent = "Payment received";
      else if (order.receivedZat > 0) watchEl.textContent = "Partial payment seen";
      else watchEl.textContent = "Watching for a payment";
    }
    if (lastStatus !== "paid" && order.status === "paid") body.classList.add("just-paid");
    lastStatus = order.status;
  } catch {
    // The next tick tries again. The page already shows the last known state.
  }
}

if (pollUrl) {
  tick();
  window.setInterval(tick, 2000);
}
