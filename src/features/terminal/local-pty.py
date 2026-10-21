"""JSON transport for a local POSIX pseudo-terminal."""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios

cols, rows = int(sys.argv[1]), int(sys.argv[2])
shell = os.environ.get('SHELL') or '/bin/zsh'
pid, fd = pty.fork()
if pid == 0:
    os.execv(shell, [shell, '-l'])
def resize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
resize(cols, rows)
print(json.dumps({'type': 'ready'}), flush=True)
buffer = b''
try:
    while True:
        readable, _, _ = select.select([fd, sys.stdin.buffer], [], [])
        if fd in readable:
            try:
                data = os.read(fd, 16384)
            except OSError:
                break
            if not data:
                break
            print(json.dumps({'type': 'data', 'data': base64.b64encode(data).decode()}), flush=True)
        if sys.stdin.buffer in readable:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                break
            buffer += data
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                command = json.loads(line)
                if command['type'] == 'input':
                    remaining = command['data'].encode()
                    while remaining:
                        remaining = remaining[os.write(fd, remaining):]
                elif command['type'] == 'resize':
                    resize(command['cols'], command['rows'])
                elif command['type'] == 'close':
                    sys.exit(0)
finally:
    os.close(fd)
    try:
        os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
