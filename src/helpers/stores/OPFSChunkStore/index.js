import Store from './OPFSChunkStore.js'

function makeBuffer (num) {
  const buf = new Uint8Array(10)
  buf.fill(num)
  return buf
}

const t = {
  error: error => console.warn(error),
  end: () => {},
  deepEqual: (a, b) => console.log('deepEqual:', JSON.stringify(a) === JSON.stringify(b)),
  equal: (a, b) => console.log('deepEqual:', JSON.stringify(a) === JSON.stringify(b)),
  ok: () => {}
}

const test1 = function (t) {
  console.log('basic put, then get')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(0, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('0123456789'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test1(t)

const test2 = function (t) {
  console.log('put invalid chunk length gives error')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123'), function (err) {
    t.ok(err instanceof Error)
    store.destroy(function (err) {
      t.error(err)
      t.end()
    })
  })
}
test2(t)

const test3 = function (t) {
  console.log('concurrent puts, then concurrent gets')
  const store = new Store(10)

  function makePutTask (i) {
    return function (cb) {
      store.put(i, makeBuffer(i), cb)
    }
  }

  function makeGetTask (i) {
    return function (cb) {
      store.get(i, function (err, data) {
        if (err) return cb(err)
        t.deepEqual(data, makeBuffer(i))
        cb(null)
      })
    }
  }

  let tasks = []
  for (let i = 0; i < 100; i++) {
    tasks.push(makePutTask(i))
  }

  (function (err) {
    t.error(err)

    tasks = []
    for (let i = 0; i < 100; i++) {
      tasks.push(makeGetTask(i))
    }

    (function (err) {
      t.error(err)
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })()
  })()
}
test3(t)

const test4 = function (t) {
  console.log('interleaved puts and gets')
  const store = new Store(10)
  const tasks = []

  function makeTask (i) {
    return function (cb) {
      store.put(i, makeBuffer(i), function (err) {
        if (err) return cb(err)
        store.get(i, function (err, data) {
          t.error(err)
          t.deepEqual(data, makeBuffer(i))
          cb(null)
        })
      })
    }
  }

  for (let i = 0; i < 100; i++) {
    tasks.push(makeTask(i))
  }

  (function (err) {
    t.error(err)
    store.destroy(function (err) {
      t.error(err)
      t.end()
    })
  })()
}
test4(t)

const test5 = function (t) {
  console.log('get with `offset` and `length` options')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(0, { offset: 2, length: 3 }, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('234'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test5(t)

const test6 = function (t) {
  console.log('get with null option')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(0, null, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('0123456789'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test6(t)

const test7 = function (t) {
  console.log('get with empty object option')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(0, {}, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('0123456789'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test7(t)

const test8 = function (t) {
  console.log('get with `offset` option')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(0, { offset: 2 }, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('23456789'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test8(t)

const test9 = function (t) {
  console.log('get with `length` option')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(0, { length: 5 }, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('01234'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test9(t)

const test10 = function (t) {
  console.log('test for sparsely populated support')
  const store = new Store(10)
  store.put(10, new TextEncoder().encode('0123456789'), function (err) {
    t.error(err)
    store.get(10, function (err, chunk) {
      t.error(err)
      t.deepEqual(chunk, new TextEncoder().encode('0123456789'))
      store.destroy(function (err) {
        t.error(err)
        t.end()
      })
    })
  })
}
test10(t)

const test11 = function (t) {
  console.log('test `put` without callback - error should be silent')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('01234'))
  store.destroy(function (err) {
    t.error(err)
    t.end()
  })
}
test11(t)

const test12 = function (t) {
  console.log('test `put` without callback - success should be silent')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'))
  store.destroy(function (err) {
    t.error(err)
    t.end()
  })
}
test12(t)

const test13 = function (t) {
  console.log('chunkLength property')
  const store = new Store(10)
  t.equal(store.chunkLength, 10)
  store.destroy(function (err) {
    t.error(err)
    t.end()
  })
}
test13(t)

const test14 = function (t) {
  console.log('test `get` on non-existent index')
  const store = new Store(10)
  store.get(0, function (err, chunk) {
    t.ok(err instanceof Error)
    store.destroy(function (err) {
      t.error(err)
      t.end()
    })
  })
}
test14(t)

const test15 = function (t) {
  console.log('test empty store\'s `close` calls its callback')
  const store = new Store(10)
  store.close(function (err) {
    t.error(err)
    t.end()
  })
}
test15(t)

const test16 = function (t) {
  console.log('test non-empty store\'s `close` calls its callback')
  const store = new Store(10)
  store.put(0, new TextEncoder().encode('0123456789'))
  store.close(function (err) {
    t.error(err)
    t.end()
  })
}
test16(t)
