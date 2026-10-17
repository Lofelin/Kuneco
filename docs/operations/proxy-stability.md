# Proxy stability and GOST validation

The forwarding state is separate from exit-probe and service-probe health. A failed HTTP request, target tunnel or probe does not close unrelated connections. A previously verified gateway keeps forwarding only through its configured upstream when probes are unavailable. Initial verification remains mandatory; a confirmed exit-IP mismatch, authentication/security failure or core exit blocks forwarding. This does not guarantee detecting an exit change while every verification service is unavailable.

The regular exit check runs every 60 seconds with jitter; failures back off from 5 seconds to 5 minutes. Service response timings are end-to-end probe times, not proxy-only latency. No throughput or long-duration reliability improvement is claimed from these functional tests.

## Validate GOST

Install the pinned official GOST 3.3.0 binaries (SHA-256 checked):

```sh
npm run proxy:install-gost
node scripts/setup/install-gost.mjs linux_arm64 # use linux_amd64 for an amd64 Docker engine
KUNECO_PROXY_ENGINE=gost npm start
npm run test:proxy
```

GOST is currently an opt-in transport sidecar behind Kuneco's authenticated gateway and fixed-exit checks. Normal startup retains the native engine. The native and GOST paths share failure-isolation behavior. Tests report GOST cases as skipped if the host binary is absent; install it to execute those cases.

Each environment receives a separate core, private authenticated loopback listener and upstream chain. There are no bypass or direct fallback nodes. Configuration files are private temporary files; credentials are not command-line arguments. Unexpected core exit immediately blocks forwarding and restarts only that environment's core. Restarts back off at 1, 2, 4, 8 and 16 seconds, with a maximum of five attempts. The original fixed exit must verify again before reopening. A core that stays alive and verified for 60 seconds resets the restart budget. Exhaustion requires an explicit reconnect. Policy quarantine (including an exit mismatch) is never cleared by automatic recovery. Stop/environment switch cancels pending recovery, and verification results from an older core cannot reopen the gateway. Explicit user-selected direct mode remains a distinct action; automatic browser/chat routing cannot silently select it.

Docker gateways use code-addressed derivative images. Upgrading replaces only the selected environment's gateway, preserves its private IP, and retains workers, volumes and account data. Failed replacement attempts restore the previous container. Other environments upgrade when next connected. A planned gateway replacement interrupts that gateway's existing streams; probe failures do not.

Reference: [GOST source and MIT license](https://github.com/go-gost/gost), [configuration](https://gost.run/en/reference/configuration/file/).


## Fault acceptance

`npm run test:proxy` includes actual host GOST process termination (SIGKILL), crash-loop limits, missing binary, restart cancellation, delayed old verification, upstream outage/recovery, changed exit quarantine, two-environment isolation and live CONNECT stream survival during failed probes/resume-style checks. These are bounded fault tests, not a long-duration reliability certification. OS sleep is represented by the resume handler's recheck path; the test does not suspend the user's Mac. Core crashes necessarily lose that core's in-flight TCP streams; recovery permits new requests and never replays a user request automatically.

## Paired performance and soak benchmark

`node scripts/benchmarks/benchmark-proxy.mjs --local --seconds=30` runs a controlled 64 KiB loopback target. For real-upstream testing, omit `--local` and supply `{config, expectedIp}` through private stdin; never put credentials in command-line arguments or reports. `GOST_BINARY` selects the pinned executable. Both gateways must verify the explicit fixed IP before testing. The real workload is HTTPS JSON from api.ipify.org and validates the exit on every measured response; it does not invoke models or billable inference APIs.

Run the real workload in a disposable, non-published test container for 1800 seconds of soak after warmup/short comparisons. Do not attach it to a user's environment private network. Keep Node version, CPU architecture, upstream, pin and target equal. The benchmark records local TCP, CONNECT tunnel, TLS, response-header and body times, paired success/failure counts, gateway socket counts and Linux GOST RSS/FDs. Shared Node memory cannot be attributed to either engine. All measured requests are cold connections, and the workload cannot establish browser warm-connection or LLM inference latency.

JSONL reports contain no proxy credentials. Only generate a final report when the `complete` event exists:

```sh
node scripts/benchmarks/summarize-proxy-benchmark.mjs local.jsonl real.jsonl report.md
```

A completed 30-minute run is bounded stability evidence, not proof of multi-day reliability. Leave GOST opt-in until results and broader workloads justify changing the default.

## Cold connections versus connection reuse

`node scripts/benchmarks/benchmark-proxy-reuse.mjs --local` compares 40 cold and 40 persistent HTTP requests per engine against the local fixture. Without `--local`, supply `{config, expectedIp}` through private stdin for 24 HTTPS requests per mode and engine. Each persistent group includes its initial connection separately; subsequent requests record Node's `reusedSocket`, socket identity, and actual connection phase timings. The pool is bound to one gateway and target. Every replacement socket must use authenticated CONNECT and normal TLS certificate validation; there is no default direct connector or automatic replay. Every real response must match the fixed exit. The final reconnect check destroys pooled sockets and requires a new tunnel.

Use `scripts/benchmarks/summarize-proxy-reuse.mjs local.jsonl real.jsonl report.md` after both runs complete. A shared existing environment gateway can be used as the authenticated upstream via its bridge address, without attaching test containers to private environment networks. Report this extra hop explicitly: such a run measures cold-versus-reused connection lifecycle, not pure independent native-versus-GOST core performance. Never change production engine selection to obtain benchmark credentials. Keep both test listeners on loopback, publish no ports, and remove only the labeled test containers after retaining logs and exit codes.

## Application connection reuse

Exit verification, region queries and HEAD service probes share bounded, per-origin HTTP/HTTPS agents owned by their `ProxyGateway` instance. Gateway instances belong to one account/environment and one proxy configuration; no agent is global. Blocking, fixed-exit quarantine, GOST failure and stop invalidate the pool generation and destroy idle/active sockets. Pending handshakes cannot enter a newer generation. A failed probe does not destroy otherwise valid connections. TLS validation and remote target DNS resolution remain enabled; every replacement connection uses the configured upstream, never a direct connector. The status `requestPool` counters expose created connections, dispatched requests and reused requests without URLs or credentials.

Account API, avatar and Cookie sync requests keep their existing explicitly direct control-plane route (needed before an environment can connect). Their pools are scoped by account, token, environment and target origin, retired on scope change, gateway transition and application exit. This route is not a fallback for proxy traffic. DeepSeek requests share a bounded TLS pool within the account/environment worker process, keyed by gateway URL/credential, API credential and explicit routing mode; scope changes and CLI completion close it. Existing explicit direct/installation modes remain separate. No transport automatically retries or replays a failed request, including POST/PUT/DELETE and streamed requests.

Limits: a peer can close idle connections sooner than our idle timeout; the next request then needs a fresh proxied handshake. A socket closed concurrently with dispatch may fail that request, which is surfaced rather than silently replayed. A 60-second probe interval therefore does not guarantee warm connections. DeepSeek pooling helps requests in one worker invocation (such as upload/chat/delete), not separate short-lived CLI processes. External CLI and browser connection pools are not replaced by this change.
