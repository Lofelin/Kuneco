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

Region queries and HEAD service probes share bounded, per-origin HTTP/HTTPS agents owned by their `ProxyGateway` instance. Exit verification always uses a separate fresh connection and retires that agent afterward; it cannot mistake a healthy old pooled tunnel for evidence about a newly established route. Gateway instances belong to one account/environment and one proxy configuration; no agent is global. Blocking, fixed-exit quarantine, GOST failure and stop invalidate the pool generation and destroy idle/active sockets. Pending handshakes cannot enter a newer generation. A failed probe does not destroy otherwise valid connections. TLS validation and remote target DNS resolution remain enabled; every replacement connection uses the configured upstream, never a direct connector. The status `requestPool` counters expose created connections, dispatched requests and reused requests without URLs or credentials.

Account API, avatar and Cookie sync requests keep their existing explicitly direct control-plane route (needed before an environment can connect). Their pools are scoped by account, token, environment and target origin, retired on scope change, gateway transition and application exit. This route is not a fallback for proxy traffic. DeepSeek requests share a bounded TLS pool within the account/environment worker process, keyed by gateway URL/credential, API credential and explicit routing mode; scope changes and CLI completion close it. Existing explicit direct/installation modes remain separate. No transport automatically retries or replays a failed request, including POST/PUT/DELETE and streamed requests.

Limits: a peer can close idle connections sooner than our idle timeout; the next request then needs a fresh proxied handshake. A socket closed concurrently with dispatch may fail that request, which is surfaced rather than silently replayed. A 60-second probe interval therefore does not guarantee warm connections. DeepSeek pooling helps requests in one worker invocation (such as upload/chat/delete), not separate short-lived CLI processes. External CLI and browser connection pools are not replaced by this change.

## Fresh verification and request deadlines

Fresh checks retain the persisted fixed exit. A confirmed mismatch quarantines the environment; unavailable detection services leave an already verified forwarding path intact. Fresh checks do not consume or clear the business pool. They run at the existing check cadence, not before every forwarded request; changes between checks or while all detectors are unavailable remain a detection limitation.

Application HTTP requests distinguish queue, connect (including DNS), CONNECT negotiation, target TLS, response headers, and response-body idle deadlines. Non-streaming requests also have a total deadline. Account requests default to 15 seconds per connection/queue stage, 30 seconds for headers/body idle and 60 seconds total. Proxy probes use the configured probe timeout per stage and three times that timeout overall. DeepSeek uses 120 seconds for headers/body idle; streams have no fixed total deadline while data keeps arriving. Timeout errors carry REQUEST_TIMEOUT and a phase without credentials.

Cancellation rejects queued callers immediately, destroys their request/handshake, and does not dispatch or replay a queued mutation. Completed/failed requests clear timers and listeners. All transports remain single-attempt, including POST and streamed operations. Run `node --test test/unit/proxy/request-lifecycle.test.mjs test/unit/proxy/proxy.test.mjs test/unit/runtimes/deepseek-runtime.test.mjs` for stalled stages, cancellation, no mutation replay and fresh-versus-stale exit tests.

## Forwarding admission and cancellation

Each gateway owns a bounded forwarding budget with per-destination fairness: 64 active HTTP requests/CONNECT tunnels and 128 waiting requests by default, with a 15-second queue deadline. An active CONNECT retains its slot until its stream closes. Excess or expired queued requests receive HTTP 503; they never establish an upstream connection or replay a request. Client cancellation is registered before admission and upstream handshakes, so cancellation removes queued work or destroys the pending connection immediately. Stop, quarantine and core failure abort pending work in that gateway only. Healthy streams are not given an arbitrary total lifetime.

Ordinary application probes have a separate budget of 4 active requests and 16 queued requests. Fresh exit verification has its own 1-active/2-waiting budget (normal verify calls already coalesce), and does not wait behind either queue. These are logical per-gateway reservations, not a guarantee of upstream bandwidth. Inbound TCP sockets, including idle/unauthenticated sockets, are additionally capped at forwarding active + queue capacity + 32; sockets above that transport cap can be closed before HTTP parsing. No overload or cancellation changes engine selection or enables direct routing. Probe failures still preserve verified forwarding; confirmed fixed-exit mismatch retains quarantine behavior.

## Forwarded HTTP response deadlines and counters

Plain HTTP forwarding has separate 30-second response-header and response-body idle deadlines, configurable through `responseHeadersTimeout` and `responseBodyTimeout`. Header waiting begins after the outbound upload finishes; arriving body chunks reset the body deadline only while the upstream response is flowing. Upload and downstream backpressure have separate progress deadlines described below. Before response headers are sent, timeout returns 504. After headers have been sent, timeout destroys the response so truncated content cannot be reported as a successful complete body. Only that request is terminated; it is never replayed. CONNECT tunnels remain opaque streams without a response or total-lifetime deadline; target TLS/application timing cannot be inferred from their encrypted bytes.

Gateway status snapshots expose current values rather than interpreting cumulative totals as active connections:

- `connections`: currently established forwarding HTTP requests plus CONNECT tunnels. This excludes queued/connecting work, probe sockets and idle inbound TCP sockets.
- `capacity.forwarding`: `active` admission slots (including handshake work), `queued`, configured limits, current `http`/`connect`, cumulative `establishedTotal`/`admittedTotal`, queue-full `rejectedTotal`, `queueTimeoutTotal`, `queueCancelledTotal`, `clientCancelledTotal`, `abortedTotal`, and `responseTimeouts.headers/body`.
- `queueCancelledTotal` includes cancellation caused by a client or gateway shutdown. `clientCancelledTotal` counts client closure before scope completion, not normal completed HTTP responses; a disconnected CONNECT cannot reveal whether a user explicitly cancelled or the client lost its connection. `abortedTotal` counts gateway-triggered scope aborts. Response deadlines are counted separately.
- `capacity.probes` and `capacity.verification`: independent active/queued/limit and cumulative admission counters. `requestPool.activeSockets`/`idleSockets` count cached probe-agent sockets only; fresh verification uses its separate capacity. Existing `requestPool.connections/requests/reused` remain cumulative.

Snapshots are refreshed on status access; counters are owned by one gateway instance and reset when it is recreated. No URLs, credentials, payloads or account identifiers are added. These counters are available through the existing status control interface; no new monitoring dashboard is introduced.

## Upload progress, downstream backpressure and phase statistics

Forwarded HTTP requests use separate 30-second upload-idle and downstream-idle budgets (`uploadIdleTimeout` and `downstreamIdleTimeout`). Connected requests remain in the upload phase until Node reports the request fully written; only then does the header-wait deadline start. Incoming upload data, write drain and observed socket write progress refresh upload idle. An early response takes precedence over upload timing.

When the response is paused by downstream backpressure, upstream body-idle timing is suspended and the downstream-idle phase applies. Drain events and local socket write progress refresh that deadline; resuming upstream flow returns to body timing. After the upstream body ends, pending downstream delivery remains bounded until the downstream response finishes. This measures local transport progress, not proof that the remote client consumed or acknowledged every byte. A persistently stalled receiver is still terminated. Forwarded HTTP has no total lifetime limit; healthy CONNECT streams remain exempt from these HTTP response deadlines.

`status.performance` contains bounded phase distributions grouped as `<kind>.<mode>.<outcome>`. Kinds are `http`, `connect`, `probe`, and `verification`; modes are `cold`, `reused`, or `unassigned` when no connection was assigned. Outcomes separate success, HTTP error responses (`http-error`), error, timeout and cancellation. Each bucket reports a lifetime count and nearest-rank p50/p95 in milliseconds from its latest 128 completed samples. Each phase also reports its own observed sample count; missing phases are absent, not zero. Snapshots are cached until a sample completes. Repeated data/drain progress resets deadlines without counting the same request repeatedly.

Measured phases are queue, upstream connect (including local DNS and upstream TLS where applicable), CONNECT negotiation, target TLS for application-owned HTTPS probes, upload, response headers, upstream body and downstream backpressure; total is wall-clock duration for the measured operation. `connect` buckets end at tunnel establishment and never pretend to measure the encrypted application lifetime, target TLS or inference latency inside CONNECT. Header duration starts after upload and is time to response headers, not strict first byte. Success and timeout distributions are kept separate.

`status.performanceReuse` exposes cold/reused/unassigned counts and reuseRate separately per kind for completed observations. Unassigned attempts are excluded from the rate denominator. Fresh verification stays cold and cannot dilute the ordinary probe reuse rate. Statistics are per gateway, reset on recreation, and contain no target URLs, credentials, request bodies or account IDs. Account-control and standalone runtime clients share lifecycle boundary handling but are not included in gateway phase statistics. No engine default, retry, exit pin or routing policy changes.

## Inbound HTTP receipt and protocol boundaries

The gateway explicitly disables Node's total request-receipt deadline (`requestTimeout: 0`). A continuously progressing upload may exceed five minutes; upload-idle, admission and handshake deadlines remain enforced. Incomplete request headers retain a 60-second deadline and inbound sockets retain their capacity cap. This does not set any total lifetime on established CONNECT tunnels.

Both HTTP directions remove standard hop-by-hop headers and fields nominated by `Connection`; Node regenerates per-hop framing. End-to-end headers remain intact, including repeated `Set-Cookie` values. Proxy credentials are never forwarded to the target. Trailer/upgrade negotiation is not passed through this ordinary HTTP path; HTTPS CONNECT remains opaque.

The gateway handles `Expect: 100-continue` itself: it authenticates, passes admission, and establishes the configured upstream tunnel before sending a single Continue response. It strips Expect before forwarding, so the origin does not send a second Continue. This is gateway permission to upload, not a promise that the origin will accept the body. Unsupported expectations receive 417 and unauthenticated requests receive 407 without Continue or an upstream attempt.

If an origin returns a final response before the upload finishes, the gateway unpipes and pauses the upload, delivers the response under normal response/downstream deadlines, and closes the inbound connection afterward. It does not drain an unbounded discarded body or reuse that connection for another request. Failures before a final response similarly close the inbound connection. No requests are retried or replayed.

Run `KUNECO_LONG_UPLOAD_TEST=1 node --test --test-name-pattern='sustained upload crosses' test/unit/proxy/proxy.test.mjs` for the opt-in 310-second real-time upload check against both native and installed GOST engines. The local origin fixture disables its own total receipt deadline to isolate the gateway boundary. Regular tests cover hop headers, Expect, early rejection, stalled transfers and healthy CONNECT survival.

## Per-destination forwarding fairness

Forwarding keeps its environment-wide defaults of 64 active and 128 waiting operations. It now also limits each normalized destination host/port to 16 active and 32 waiting operations (`targetForwardingLimit`, `targetQueueLimit`, clamped defaults for smaller global budgets). HTTP and CONNECT to the same destination share the quota. Host casing, trailing dot and IPv6 brackets are normalized; different DNS aliases are still distinct destinations, not inferred to be one service. The gateway does not resolve target DNS locally to group aliases.

Each destination retains FIFO ordering. Eligible destinations rotate when slots become available; a destination already at its active limit does not block another destination. Healthy existing CONNECT streams are never preempted or assigned a total deadline. Fairness governs new admission, not bandwidth or encrypted requests within an existing CONNECT stream. If enough distinct destinations occupy all global slots, new work still queues or times out; capacity is not unlimited.

Per-target or global queue overflow returns 503, and cancellation/queue timeout removes work before dispatch. No mutation is replayed. Probe and fresh-verification queues remain independent, preserving their reserved logical capacity. Target records are removed once neither active nor queued work remains. Status exposes only limit/count aggregates (`perTargetLimit`, `perTargetQueueLimit`, `activeTargets`, `queuedTargets`, `targetRejectedTotal`), never target names.

Mixed native/GOST fixture acceptance combines long CONNECT streams, queued cancellation/expiry, rejected overload, slowly uploaded POST with slow response consumption, a failed probe, fresh exit verification and another isolated environment. It verifies complete delivery, exactly one POST, intact healthy streams and empty target bookkeeping after release. This bounded functional workload is not a sustained throughput or RSS/FD leak certification; long soak measurements remain a separate benchmark.
