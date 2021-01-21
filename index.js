import { CID } from 'multiformats'
import { base64 } from 'multiformats/bases/base64'
import { Token, Type } from 'cborg'
import * as cborgJson from 'cborg/json'

function cidEncoder (obj) {
  if (obj.asCID !== obj) {
    return null // any other kind of object
  }
  const cid = CID.asCID(obj)
  /* c8 ignore next 4 */
  // very unlikely case, and it'll probably throw a recursion error in cborg
  if (!cid) {
    return null
  }
  const cidString = cid.toString()

  return [
    new Token(Type.map, Infinity, 1),
    new Token(Type.string, '/', 1), // key
    new Token(Type.string, cidString, cidString.length), // value
    new Token(Type.break, undefined, 1)
  ]
}

function bytesEncoder (bytes) {
  const bytesString = base64.encode(bytes)
  return [
    new Token(Type.map, Infinity, 1),
    new Token(Type.string, '/', 1), // key
    new Token(Type.map, Infinity, 1), // value
    new Token(Type.string, 'bytes', 5), // inner key
    new Token(Type.string, bytesString, bytesString.length), // inner value
    new Token(Type.break, undefined, 1),
    new Token(Type.break, undefined, 1)
  ]
}

function undefinedEncoder () {
  throw new Error('`undefined` is not supported by the IPLD Data Model and cannot be encoded')
}

function numberEncoder (num) {
  if (Number.isNaN(num)) {
    throw new Error('`NaN` is not supported by the IPLD Data Model and cannot be encoded')
  }
  if (num === Infinity || num === -Infinity) {
    throw new Error('`Infinity` and `-Infinity` is not supported by the IPLD Data Model and cannot be encoded')
  }
}

const encodeOptions = {
  typeEncoders: {
    Object: cidEncoder,
    Uint8Array: bytesEncoder, // TODO: all the typedarrays
    Buffer: bytesEncoder, // TODO: all the typedarrays
    undefined: undefinedEncoder,
    number: numberEncoder
  }
}

function encode (obj) {
  return cborgJson.encode(obj, encodeOptions)
}

class DagJsonTokenizer extends cborgJson.Tokenizer {
  constructor (data, options) {
    super(data, options)
    this.tokenBuffer = []
  }

  done () {
    return this.tokenBuffer.length === 0 && super.done()
  }

  _next () {
    return this.tokenBuffer.length ? this.tokenBuffer.pop() : super.next()
  }

  next () {
    const token = this._next()

    if (token.type === Type.map) {
      const keyToken = this._next()
      if (keyToken.type === Type.string && keyToken.value === '/') {
        const valueToken = this._next()
        if (valueToken.type === Type.string) { // *must* be a CID
          const breakToken = this._next() // swallow the end-of-map token
          if (breakToken.type !== Type.break) {
            throw new Error('Invalid encoded CID form')
          }
          this.tokenBuffer.push(valueToken) // CID.parse will pick this up after our tag token
          return new Token(Type.tag, 42, 0)
        }
        if (valueToken.type === Type.map) {
          const innerKeyToken = this._next()
          if (innerKeyToken.type === Type.string && innerKeyToken.value === 'bytes') {
            const innerValueToken = this._next()
            if (innerValueToken.type === Type.string) { // *must* be Bytes
              for (let i = 0; i < 2; i++) {
                const breakToken = this._next() // swallow two end-of-map tokens
                if (breakToken.type !== Type.break) {
                  throw new Error('Invalid encoded Bytes form')
                }
              }
              const bytes = base64.decode(innerValueToken.value)
              return new Token(Type.bytes, bytes, innerValueToken.value.length)
            }
            this.tokenBuffer.push(innerValueToken) // bail
          }
          this.tokenBuffer.push(innerKeyToken) // bail
        }
        this.tokenBuffer.push(valueToken) // bail
      }
      this.tokenBuffer.push(keyToken) // bail
    }
    return token
  }
}

const decodeOptions = {
  allowIndefinite: false,
  allowUndefined: false,
  allowNaN: false,
  allowInfinity: false,
  allowBigInt: true, // this will lead to BigInt for ints outside of
  // safe-integer range, which may surprise users
  strict: true,
  useMaps: false,
  tags: []
}

// we're going to get TAG(42)STRING("bafy...") from the tokenizer so we only need
// to deal with the STRING("bafy...") at this point
decodeOptions.tags[42] = CID.parse

function decode (byts) {
  const options = Object.assign(decodeOptions, { tokenizer: new DagJsonTokenizer(byts) })
  return cborgJson.decode(byts, options)
}

const name = 'dag-json'
const code = 0x0129

export { encode, decode, name, code }
