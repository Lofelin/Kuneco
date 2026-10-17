# Proxy stability and GOST validation

The forwarding state is separate from exit-probe and service-probe health. A failed HTTP request, target tunnel or probe does not close unrelated connections. A previously verified gateway keeps forwarding only through its configured upstream when probes are unavailable. Initial verification remains mandatory; a confirmed exit-IP mismatch, authentication/security failure or core exit blocks forwarding. This does not guarantee detecting an exit change while every verification service is unavailable.

The regular exit check runs every 60 seconds with jitter; failures back off from 5 seconds to 5 minutes. Service response timings are end-to-end probe times, not proxy-only latency. No throughput or long-duration reliability improvement is claimed from these functional tests.

## Validate GOST

Install the pinned official GOST 3.3.0 binaries (SHA-256 checked):

```sh
npm run proxy:install-gost
node scripts/install-gost.mjs linux_arm64 # use linux_amd64 for an amd64 Docker engine
KUNECO_PROXY_ENGINE=gost npm start
npm run test:proxy
```

GOST is currently an opt-in transport sidecar behind Kuneco's authenticated gateway and fixed-exit checks. Normal startup retains the native engine. The native and GOST paths share failure-isolation behavior. Tests report GOST cases as skipped if the host binary is absent; install it to execute those cases.

Each environment receives a separate core, private authenticated loopback listener and upstream chain. There are no bypass or direct fallback nodes. Configuration files are private temporary files; credentials are not command-line arguments. Unexpected core exit immediately blocks forwarding and restarts only that environment's core. Restarts back off at 1, 2, 4, 8 and 16 seconds, with a maximum of five attempts. The original fixed exit must verify again before reopening. A core that stays alive and verified for 60 seconds resets the restart budget. Exhaustion requires an explicit reconnect. Policy quarantine (including an exit mismatch) is never cleared by automatic recovery. Stop/environment switch cancels pending recovery, and verification results from an older core cannot reopen the gateway. Explicit user-selected direct mode remains a distinct action; automatic browser/chat routing cannot silently select it.

Docker gateways use code-addressed derivative images. Upgrading replaces only the selected environment's gateway, preserves its private IP, and retains workers, volumes and account data. Failed replacement attempts restore the previous container. Other environments upgrade when next connected. A planned gateway replacement interrupts that gateway's existing streams; probe failures do not.

Reference: [GOST source and MIT license](https://github.com/go-gost/gost), [configuration](https://gost.run/en/reference/configuration/file/).


## Fault acceptance

`npm run test:proxy` includes actual host GOST process termination (SIGKILL), crash-loop limits, missing binary, restart cancellation, delayed old verification, upstream outage/recovery, changed exit quarantine, two-environment isolation and live CONNECT stream survival during failed probes/resume-style checks. These are bounded fault tests, not a long-duration reliability certification. OS sleep is represented by the resume handler's recheck path; the test does not suspend the user's Mac. Core crashes necessarily lose that core's in-flight TCP streams; recovery permits new requests and never replays a user request automatically.
