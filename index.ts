import { pack, unpack } from "./utf8-buffer.js";
import utf8Size from "utf8-buffer-size";

export class Writer {
  private pos = 0;
  private view: DataView;
  private bytes: Uint8Array;

  public constructor() {
    this.view = new DataView(new ArrayBuffer(64));
    this.bytes = new Uint8Array(this.view.buffer);
  }

  public writeUInt8(val: number) {
    this.ensureSize(1);
    this.view.setUint8(this.pos, val);
    this.pos += 1;
    return this;
  }

  public writeUInt32(val: number) {
    this.ensureSize(4);
    this.view.setUint32(this.pos, val);
    this.pos += 4;
    return this;
  }

  public writeUInt64(val: bigint) {
    this.ensureSize(8);
    this.view.setBigUint64(this.pos, val);
    this.pos += 8;
    return this;
  }

  public writeUVarint(val: number) {
    if (val < 0x80) {
      this.ensureSize(1);
      this.view.setUint8(this.pos, val);
      this.pos += 1;
    } else if (val < 0x4000) {
      this.ensureSize(2);
      this.view.setUint16(
        this.pos,
        (val & 0x7f) | ((val & 0x3f80) << 1) | 0x8000
      );
      this.pos += 2;
    } else if (val < 0x200000) {
      this.ensureSize(3);
      this.view.setUint8(this.pos, (val >> 14) | 0x80);
      this.view.setUint16(
        this.pos + 1,
        (val & 0x7f) | ((val & 0x3f80) << 1) | 0x8000
      );
      this.pos += 3;
    } else if (val < 0x10000000) {
      this.ensureSize(4);
      this.view.setUint32(
        this.pos,
        (val & 0x7f) |
          ((val & 0x3f80) << 1) |
          ((val & 0x1fc000) << 2) |
          ((val & 0xfe00000) << 3) |
          0x80808000
      );
      this.pos += 4;
    } else if (val < 0x800000000) {
      this.ensureSize(5);
      this.view.setUint8(this.pos, Math.floor(val / Math.pow(2, 28)) | 0x80);
      this.view.setUint32(
        this.pos + 1,
        (val & 0x7f) |
          ((val & 0x3f80) << 1) |
          ((val & 0x1fc000) << 2) |
          ((val & 0xfe00000) << 3) |
          0x80808000
      );
      this.pos += 5;
    } else if (val < 0x40000000000) {
      this.ensureSize(6);
      const shiftedVal = Math.floor(val / Math.pow(2, 28));
      this.view.setUint16(
        this.pos,
        (shiftedVal & 0x7f) | ((shiftedVal & 0x3f80) << 1) | 0x8080
      );
      this.view.setUint32(
        this.pos + 2,
        (val & 0x7f) |
          ((val & 0x3f80) << 1) |
          ((val & 0x1fc000) << 2) |
          ((val & 0xfe00000) << 3) |
          0x80808000
      );
      this.pos += 6;
    } else {
      throw new Error("Value out of range");
    }
    return this;
  }

  public writeFloat(val: number) {
    this.ensureSize(4);
    this.view.setFloat32(this.pos, val, true);
    this.pos += 4;
    return this;
  }

  public writeBits(bits: boolean[]) {
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        if (i + j == bits.length) {
          break;
        }
        byte |= (bits[i + j] ? 1 : 0) << j;
      }
      this.writeUInt8(byte);
    }
    return this;
  }

  public writeString(val: string) {
    if (val.length > 0) {
      const byteSize = utf8Size(val);
      this.writeUVarint(byteSize);
      this.ensureSize(byteSize);
      pack(val, this.bytes, this.pos);
      this.pos += byteSize;
    } else {
      this.writeUInt8(0);
    }
    return this;
  }

  public writeBuffer(buf: Uint8Array) {
    this.ensureSize(buf.length);
    this.bytes.set(buf, this.pos);
    this.pos += buf.length;
    return this;
  }

  public toBuffer() {
    return this.bytes.subarray(0, this.pos);
  }

  private ensureSize(size: number) {
    while (this.view.byteLength < this.pos + size) {
      const newView = new DataView(new ArrayBuffer(this.view.byteLength * 2));
      const newBytes = new Uint8Array(newView.buffer);
      newBytes.set(this.bytes);
      this.view = newView;
      this.bytes = newBytes;
    }
  }
}

export class Reader {
  private pos = 0;
  private view: DataView;
  private bytes: Uint8Array;

  public constructor(buf: ArrayBufferView) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.bytes = new Uint8Array(
      this.view.buffer,
      buf.byteOffset,
      buf.byteLength
    );
  }

  public readUInt8() {
    const val = this.view.getUint8(this.pos);
    this.pos += 1;
    return val;
  }

  public readUInt32() {
    const val = this.view.getUint32(this.pos);
    this.pos += 4;
    return val;
  }

  public readUInt64() {
    const val = this.view.getBigUint64(this.pos);
    this.pos += 8;
    return val;
  }

  public readUVarint() {
    let val = 0;
    while (true) {
      let byte = this.view.getUint8(this.pos++);
      if (byte < 0x80) {
        return val + byte;
      }
      val = (val + (byte & 0x7f)) * 128;
    }
  }

  public readFloat() {
    const val = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return val;
  }

  public readBits(numBits: number) {
    const numBytes = Math.ceil(numBits / 8);
    const bytes = this.bytes.slice(this.pos, this.pos + numBytes);
    const bits: boolean[] = [];
    for (const byte of bytes) {
      for (let i = 0; i < 8 && bits.length < numBits; i++) {
        bits.push(((byte >> i) & 1) === 1);
      }
    }
    this.pos += numBytes;
    return bits;
  }

  public readString() {
    const len = this.readUVarint();
    if (len === 0) {
      return "";
    }
    const val = unpack(this.bytes, this.pos, this.pos + len);
    this.pos += len;
    return val;
  }

  public readBuffer(numBytes: number) {
    const bytes = this.bytes.slice(this.pos, this.pos + numBytes);
    this.pos += numBytes;
    return bytes;
  }

  public remaining() {
    return this.view.byteLength - this.pos;
  }
}
