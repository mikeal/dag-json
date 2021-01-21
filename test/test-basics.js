'use strict'
/* eslint-env mocha */
import garbage from 'ipld-garbage'
import chai from 'chai'
import { encode, decode } from '@ipld/dag-json'
import { bytes, CID } from 'multiformats'

const { assert } = chai
const same = assert.deepStrictEqual
const test = it

const recode = byts => encode(decode(byts))

const link = CID.parse('bafyreifepiu23okq5zuyvyhsoiazv2icw2van3s7ko6d3ixl5jx2yj2yhu')

describe('basic dag-json', () => {
  test('encode decode', () => {
    let byts = encode({ hello: 'world' })
    same(JSON.parse(bytes.toString(recode(byts))), { hello: 'world' })
    const o = { link, byts: bytes.fromString('asdf'), n: null, o: {} }
    byts = encode(o)
    same(decode(byts), o)
    same(bytes.isBinary(decode(byts).byts), true)
  })

  test('use reserved space', () => {
    // allowed
    same(decode(encode({ '/': { bytes: true } })), { '/': { bytes: true } })
    same(decode(encode({ '/': { type: 'stringName' } })), { '/': { type: 'stringName' } })
    same(decode(encode({ '/': bytes.fromString('asdf') })), { '/': bytes.fromString('asdf') })

    // TODO: test encode() doesn't allow this
    assert.throws(() => decode(encode({ '/': link.toString(), bop: 'bip' })))
    assert.throws(() => decode(encode({ '/': { bytes: 'mS7ldeA', bop: 'bip' } })))
    assert.throws(() => decode(encode({ '/': { bytes: 'mS7ldeA' }, bop: 'bip' })))
    assert.throws(() => decode(encode({ '/': { bytes: 'mS7ldeA', bop: 'bip' }, bop: 'bip' })))
  })

  test('native types', done => {
    const flip = obj => decode(encode(obj))
    same(flip('test'), 'test')
    same(flip(null), null)
    same(flip(12), 12)
    same(flip(-1), -1)
    same(flip(1.2), 1.2)
    same(flip(true), true)
    same(flip(false), false)
    same(flip([]), [])
    same(flip(['asdf']), ['asdf'])
    done()
  })

  test('error on circular references', () => {
    const circularObj = {}
    circularObj.a = circularObj
    assert.throws(() => encode(circularObj), /object contains circular references/)
    const circularArr = [circularObj]
    circularObj.a = circularArr
    assert.throws(() => encode(circularArr), /object contains circular references/)
  })

  test('error on encoding undefined', () => {
    assert.throws(() => encode(undefined), /\Wundefined\W.*not supported/)
    const objWithUndefined = { a: 'a', b: undefined }
    assert.throws(() => encode(objWithUndefined), /\Wundefined\W.*not supported/)
  })

  test('error on encoding IEEE 754 specials', () => {
    for (const special of [NaN, Infinity, -Infinity]) {
      assert.throws(() => encode(special), new RegExp(`\\W${String(special)}\\W.*not supported`))
      const objWithSpecial = { a: 'a', b: special }
      assert.throws(() => encode(objWithSpecial), new RegExp(`\\W${String(special)}\\W.*not supported`))
      const arrWithSpecial = [1, 1.1, -1, -1.1, Number.MAX_SAFE_INTEGER, special, Number.MIN_SAFE_INTEGER]
      assert.throws(() => encode(arrWithSpecial), new RegExp(`\\W${String(special)}\\W.*not supported`))
    }
  })

  test('fuzz serialize and deserialize with garbage', function () {
    // filter out fuzz garbage for objects that are disqualified by DAG-JSON rules
    const checkObj = (obj) => {
      if (Array.isArray(obj)) {
        return obj.every(checkObj)
      }
      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj)) {
          if (key === '/') {
            if (typeof value === 'string') {
              return false
            }
            if (value && typeof value === 'object' && value.bytes !== undefined) {
              return false
            }
          }
          if (!checkObj(value)) {
            return false
          }
        }
      }
      return true
    }

    this.timeout(5000)
    for (let ii = 0; ii < 1000; ii++) {
      const original = garbage(300)
      if (!checkObj(original)) {
        continue
      }
      try {
        const encoded = encode(original)
        const decoded = decode(encoded)
        same(decoded, original)
      } catch (err) {
        console.log('Failed on fuzz object:', original)
        throw err
      }
    }
  })
})
