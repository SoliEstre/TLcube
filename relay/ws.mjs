/**
 * ws.mjs — RFC 6455 서버. Node 내장 crypto + net 만 쓴다.
 *
 * Node 24 의 `WebSocket` 은 클라이언트뿐이다. 서버를 의존성 없이 붙이려면
 * 핸드셰이크와 프레이밍을 직접 한다. 확장(permessage-deflate)은 받지 않는다.
 */

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OP_CONT = 0x0;
export const OP_TEXT = 0x1;
export const OP_BIN = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

const MAX_CONTROL_PAYLOAD = 125;
const SLOW_CONSUMER_BYTES = 1 * 1024 * 1024;

/** RFC 6455 §1.3 예제 벡터와 같은 계산. */
export function secAccept(key) {
  return createHash('sha1').update(String(key) + GUID).digest('base64');
}

export function upgradeResponse(key) {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${secAccept(key)}`,
    '',
    '',
  ].join('\r\n');
}

export function isUpgradeRequest(req) {
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const connection = String(req.headers.connection || '').toLowerCase();
  return upgrade === 'websocket' && connection.includes('upgrade');
}

/** 서버 → 클라이언트 (마스크 없음). */
export function encodeFrame(opcode, data, { fin = true } = {}) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

/** 테스트·클라이언트 시뮬용. 서버는 수신 프레임이 마스크돼 있어야 한다. */
export function encodeMaskedFrame(opcode, data, maskKey, { fin = true } = {}) {
  const payload = Buffer.from(data);
  const mask = Buffer.isBuffer(maskKey) ? maskKey : Buffer.from(maskKey);
  if (mask.length !== 4) throw new Error('mask must be 4 bytes');
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i & 3];
  const body = encodeFrame(opcode, masked, { fin });
  body[1] |= 0x80;
  const len7 = body[1] & 0x7f;
  const hdr = len7 === 127 ? 10 : len7 === 126 ? 4 : 2;
  return Buffer.concat([body.subarray(0, hdr), mask, body.subarray(hdr)]);
}

/**
 * @returns {{ needMore: true } | { error: string, code: number } | {
 *   fin: boolean, opcode: number, payload: Buffer, consumed: number
 * }}
 */
export function tryReadFrame(buf, maxPayload) {
  if (buf.length < 2) return { needMore: true };
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const rsv = b0 & 0x70;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let off = 2;

  if (rsv) return { error: 'rsv', code: 1002 };
  if (!masked) return { error: 'unmasked', code: 1002 };

  if (len === 126) {
    if (buf.length < 4) return { needMore: true };
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return { needMore: true };
    const hi = buf.readUInt32BE(2);
    const lo = buf.readUInt32BE(6);
    if (hi !== 0 || lo > maxPayload) return { error: 'too big', code: 1009 };
    len = lo;
    off = 10;
  }

  if (len > maxPayload) return { error: 'too big', code: 1009 };

  const isControl = opcode >= 0x8;
  if (isControl && (!fin || len > MAX_CONTROL_PAYLOAD)) {
    return { error: 'bad control', code: 1002 };
  }
  if (opcode !== OP_CONT && opcode !== OP_TEXT && opcode !== OP_BIN
      && opcode !== OP_CLOSE && opcode !== OP_PING && opcode !== OP_PONG) {
    return { error: 'bad opcode', code: 1002 };
  }

  if (buf.length < off + 4 + len) return { needMore: true };
  const mask = buf.subarray(off, off + 4);
  off += 4;
  const payload = Buffer.from(buf.subarray(off, off + len));
  for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
  return { fin, opcode, payload, consumed: off + len };
}

export function acceptUpgrade(req, socket, head, opts = {}) {
  const key = req.headers['sec-websocket-key'];
  const version = String(req.headers['sec-websocket-version'] || '');
  if (!isUpgradeRequest(req) || !key || version !== '13') {
    try {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    } catch { /* */ }
    try { socket.destroy(); } catch { /* */ }
    return null;
  }
  try {
    socket.write(upgradeResponse(key));
  } catch {
    try { socket.destroy(); } catch { /* */ }
    return null;
  }
  const ws = new WsConnection(socket, opts);
  if (head && head.length) ws.push(head);
  return ws;
}

export class WsConnection {
  constructor(socket, { maxPayload = 128 * 1024 } = {}) {
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.fragOp = 0;
    this.frag = [];
    this.fragLen = 0;
    this.closed = false;
    /** @type {null | ((text: string) => void)} */
    this.ontext = null;
    /** @type {null | ((code: number) => void)} */
    this.onclose = null;
    socket.on('data', (chunk) => {
      try { this.push(chunk); } catch { this.close(1002, 'protocol'); }
    });
    socket.on('error', () => this.cleanup(1006));
    socket.on('close', () => this.cleanup(1006));
    socket.on('end', () => this.cleanup(1006));
  }

  send(text) {
    if (this.closed || this.socket.destroyed) throw new Error('closed');
    if (this.socket.writableLength > SLOW_CONSUMER_BYTES) {
      this.close(1008, 'slow');
      throw new Error('slow consumer');
    }
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(String(text), 'utf8')));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    try {
      const r = Buffer.from(String(reason), 'utf8').subarray(0, 123);
      const payload = Buffer.allocUnsafe(2 + r.length);
      payload.writeUInt16BE(code & 0xffff, 0);
      r.copy(payload, 2);
      this.socket.write(encodeFrame(OP_CLOSE, payload));
    } catch { /* */ }
    try { this.socket.end(); } catch { /* */ }
    this.cleanup(code);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    while (!this.closed) {
      const frame = tryReadFrame(this.buf, this.maxPayload);
      if (frame.needMore) return;
      if (frame.error) {
        this.close(frame.code || 1002, frame.error);
        return;
      }
      this.buf = this.buf.subarray(frame.consumed);
      this.handle(frame);
    }
  }

  handle(frame) {
    switch (frame.opcode) {
      case OP_CLOSE:
        this.close(1000);
        return;
      case OP_PING:
        try { this.socket.write(encodeFrame(OP_PONG, frame.payload)); } catch { /* */ }
        return;
      case OP_PONG:
        return;
      case OP_BIN:
        this.close(1003, 'binary');
        return;
      case OP_TEXT:
      case OP_CONT:
        this.handleData(frame);
        return;
      default:
        this.close(1002, 'opcode');
    }
  }

  handleData(frame) {
    if (frame.opcode === OP_TEXT) {
      if (this.fragOp) {
        this.close(1002, 'frag');
        return;
      }
      if (frame.fin) {
        this.emitText(frame.payload);
        return;
      }
      this.fragOp = OP_TEXT;
      this.frag = [frame.payload];
      this.fragLen = frame.payload.length;
      return;
    }
    // continuation
    if (!this.fragOp) {
      this.close(1002, 'orphan-cont');
      return;
    }
    this.fragLen += frame.payload.length;
    if (this.fragLen > this.maxPayload) {
      this.close(1009, 'too big');
      return;
    }
    this.frag.push(frame.payload);
    if (frame.fin) {
      const all = Buffer.concat(this.frag, this.fragLen);
      this.frag = [];
      this.fragLen = 0;
      this.fragOp = 0;
      this.emitText(all);
    }
  }

  emitText(buf) {
    let text;
    try {
      text = buf.toString('utf8');
    } catch {
      this.close(1007, 'utf8');
      return;
    }
    if (this.ontext) {
      try { this.ontext(text); } catch { /* 상위에서 격리 */ }
    }
  }

  cleanup(code) {
    if (this._cleaned) return;
    this._cleaned = true;
    this.closed = true;
    if (this.onclose) {
      try { this.onclose(code); } catch { /* */ }
    }
  }
}
