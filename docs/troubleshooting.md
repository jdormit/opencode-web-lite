# Troubleshooting

## Readiness fails

Call `GET /healthz` and `GET /readyz` on the loopback listener. A `503` readiness response means shutdown has started. These endpoints intentionally say nothing about OpenCode. Check the home connection status or probe OpenCode's `/global/health` from the app host.

## The app rejects the host

The production server returns `421` when the request authority does not match its listener. Configure the reverse proxy to send the expected `Host`, and do not expose Bun through aliases. A non-loopback Bun bind is rejected because application authentication is not implemented.

## Events arrive in batches

Disable response buffering and caching for the SSE path. Increase the proxy read timeout. Do not enable middleware that reads the full response before forwarding it.

## Terminal does not connect

Confirm that the proxy forwards `Upgrade` and `Connection` for WebSockets and keeps the original same-origin browser request. Terminal tickets expire and can be used once. Reload the terminal to request a fresh ticket instead of reusing a URL.

## Browser tests fail to start

Install all pinned engines with `bunx playwright install --with-deps chromium firefox webkit`. Ensure ports 3000 and 4097 are free. Tests build and run the production app, not the Vite development server.

## Bundle budget fails

Open `bundle-report.json`. Sizes are Brotli-compressed production files. Initial JavaScript must stay at or below 120 KiB, CSS at 35 KiB, fonts at 150 KiB, and ordinary lazy JavaScript chunks at 100 KiB. Split a feature at its route or interaction boundary instead of raising a budget without measurements.

## Terminal accessibility

xterm provides keyboard input and an optional screen-reader mode, but terminal applications can redraw content in ways that assistive technology cannot interpret reliably. Use the accessible terminal tab controls, status text, resize buttons, reconnect action, and close action around the canvas. When command output must be reviewed with a screen reader, run the command through the prompt shell tool or copy terminal output into a text surface. Do not rely on color alone inside terminal programs.
