"use strict"

const errors = require("../errors")
const klass = require("../class").class
const objectify = require("../Serializer").Serializer.objectify
const typeOf = require("../type").type
const worker = require("./workers/models").worker

const eventWM = require("../Event")._eventWM
const Event = require("../Event").Event
const Node = require("../Node").Node
const UID = require("../UID").UID

module.exports.AddEvt = klass(Event, statics => {
    Object.defineProperties(statics, {
        NAME: { enumerable: true,
            value: "add"
        }
    })
    return {
        constructor: function(keys = []){
            Event.call(this, module.exports.AddEvt.NAME)
            eventWM.get(this).keys = keys
            Object.freeze(eventWM.get(this).keys)
        }
      , keys: { enumerable: true,
            get: function(){
                return eventWM.get(this).keys
            }
        }
    }
})

module.exports.BusyEvt = klass(Event, statics => {
    Object.defineProperties(statics, {
        NAME: { enumerable: true,
            value: "busy"
        }
    })
    return {
        constructor: function(detail = {}){
            Event.call(this, module.exports.BusyEvt.NAME, { bubbles: false, detail })
        }
    }
})

module.exports.IdleEvt = klass(Event, statics => {
    Object.defineProperties(statics, {
        NAME: { enumerable: true,
            value: "idle"
        }
    })
    return {
        constructor: function(detail = {}){
            Event.call(this, module.exports.IdleEvt.NAME, { bubbles: false, detail })
        }
    }
})

module.exports.RemoveEvt = klass(Event, statics => {
    Object.defineProperties(statics, {
        NAME: { enumerable: true,
            value: "remove"
        }
    })
    return {
        constructor: function(keys = {}){
            Event.call(this, module.exports.RemoveEvt.NAME)

            eventWM.get(this).keys = keys
            Object.freeze(eventWM.get(this).keys)
        }
      , keys: { enumerable: true,
            get: function(){
                return eventWM.get(this).keys
            }
        }
    }
})

module.exports.UpdateEvt = klass(Event, statics => {
    Object.defineProperties(statics, {
        NAME: { enumerable: true,
            value: "update"
        }
    })
    return {
        constructor: function(keys = []){
            Event.call(this, module.exports.UpdateEvt.NAME)

            eventWM.get(this).keys = keys
            Object.freeze(eventWM.get(this).keys)
        }
      , keys: { enumerable: true,
            get: function(){
                return eventWM.get(this).keys
            }
        }
    }
})

module.exports.TreeChangeEvt = klass(Event, statics => {
    Object.defineProperties(statics, {
        NAME: { enumerable: true,
            value: "treechange"
        }
    })
    return {
        constructor: function(keys = []){
            Event.call(this, module.exports.TreeChangeEvt.NAME, { bubbles: false })

            eventWM.get(this).keys = keys
            Object.freeze(eventWM.get(this).keys)
        }
      , keys: { enumerable: true,
            get: function(){
                return eventWM.get(this).keys
            }
        }
    }
})

module.exports.Model = klass(Node, statics => {
    const models = new WeakMap

    const treechange = (model, keys) => {
        if ( !model.hasChildNodes() )
          return

        model.childNodes.forEach(node => {
            node.dispatchEvent( new module.exports.TreeChangeEvt(keys) )
        })
    }

    return {
        constructor: function(){
            Node.call(this)

            models.set(this, Object.create(null))
            models.get(this).hooks = Object.create(null)
            models.get(this).op = Promise.resolve()
            models.get(this).uid = UID.uid()
            models.get(this).busy = false

            this.addEventListener(module.exports.TreeChangeEvt.NAME, e =>  {
                if ( e.target !== this )
                  return

                treechange(this, e.keys)
            }, true)

            if ( arguments.length )
              this.write.apply(this, arguments)
        }
      , chain: { enumerable: true,
            get: function(){
                let chain = []
                let node = this

                while ( !!node )
                  chain.push(node.uid),
                  node = node.parentNode

                return chain
            }
        }
      , hook: { enumerable: true,
            value: function(key, fn=v=>v){
                key = typeOf(key) == "string" ? key : Object.prototype.toString.call(key)

                models.get(this).hooks[key] = fn
            }
        }
      , op: { enumerable: true,
            get: function(){ return this.operation }
        }
      , operation: { enumerable: true,
            get: function(){ return models.get(this).op }
        }
      , read: { enumerable: true,
            value: function(...args){
                models.get(this).op = models.get(this).op.then(()=>{
                    return new Promise((resolve, reject) => {
                        let trace = args.length > 1 && typeOf(args[args.length-1]) == "boolean" ? args.pop()
                                 : false
                        let cb = typeOf(args[args.length-1]) == "function" ? args.pop() : Function.prototype
                        let data = args.length > 1 ? args : args[0]

                        if ( !models.get(this).busy )
                          models.get(this).busy = true,
                          this.dispatchEvent(new module.exports.BusyEvt)

                        let port = worker.message({
                            chain: this.chain
                          , cmd: trace?"trace":"read"
                          , data
                        })

                        port.onmessage = e => {
                            if ( !!e.data.error )
                              this.dispatchEvent("error", e.data.message),
                              cb(new Error(e.data.message)),
                              reject()
                            else {
                                let keys = Object.keys(e.data.data)
                                let clone = Object.create(e.data.data)

                                keys.forEach(k=>{
                                    if ( models.get(this).hooks[k] ) {
                                        if ( !trace ) clone[k] = models.get(this).hooks[k](clone.__proto__[k])
                                        else
                                        clone[k] = [].concat(clone.__proto__[k]),
                                        clone[k].unshift({ value: models.get(this).hooks[k](clone[k][0].value), meta: { origin: "hook" }  })

                                    }
                                    else {
                                        if ( trace ) clone[k] = [].concat(clone.__proto__[k])
                                        else clone[k] = clone.__proto__[k]
                                    }
                                })

                                this.dispatchEvent("read", clone)
                                cb(null, clone)
                                resolve(clone)
                            }


                            clearTimeout(models.get(this).idleTimer)
                            models.get(this).idleTimer = setTimeout(() => {
                                models.get(this).busy = true
                                this.dispatchEvent(new module.exports.IdleEvt)
                            }, 4)
                        }
                    })
                })

                return models.get(this).op
            }
        }
      , trace: { enumerable: true,
            value: function(...args){
                return this.read.apply(this, [].concat(args, true))
            }
        }
      , write: { enumerable: true,
            value: function(...args){
                models.get(this).op = models.get(this).op.then(()=>{
                    return new Promise((resolve, reject) => {
                          let cb = typeOf(args[args.length-1]) == "function" ? args.pop() : Function.prototype
                          let meta = args.length > 2 && typeOf(args[args.length-1]) == "object" ? args.pop()
                                   : null
                          let data = args.length == 2 && typeOf(args[0]) == "string" ? { [args[0]] : typeof args[1] == "undefined" ? "__undefined" : args[1]  }
                                   : args.length == 1 && typeOf(args[0]) == "string" ? function(){
                                        try { return JSON.parse(args[0]) }
                                        catch(e) {
                                            try { return objectify(args[0])  }
                                            catch(e) {
                                                throw e //TODO
                                            }
                                        }
                                    }()
                                   : args[0]

                          if ( !models.get(this).busy )
                            models.get(this).busy = true,
                            this.dispatchEvent(new module.exports.BusyEvt)

                          let port = worker.message({
                              cmd: "write"
                            , data, meta
                            , chain: this.chain
                          })

                          port.onmessage = e => {
                              if ( !!e.data.error )
                                reject(e.data.message),
                                cb(new Error(e.data.message)),
                                this.dispatchEvent("error", e.data.message)
                              else {
                                  if ( typeOf(e.data.add) == "array" && e.data.add.length > 0 )
                                    this.dispatchEvent(new module.exports.AddEvt(e.data.add))

                                  if ( typeOf(e.data.remove) == "array" && e.data.remove.length > 0 )
                                    this.dispatchEvent(new module.exports.RemoveEvt(e.data.remove))

                                  if ( typeOf(e.data.update) == "array" && e.data.update.length > 0 )
                                    this.dispatchEvent(new module.exports.UpdateEvt(e.data.update)),
                                    treechange(this, e.data.update)


                                  cb(null)
                                  resolve(Date.now())
                              }

                              clearTimeout(models.get(this).idleTimer)
                              models.get(this).idleTimer = setTimeout(() => {
                                  models.get(this).busy = false
                                  this.dispatchEvent(new module.exports.IdleEvt)
                              }, 4)
                          }
                    })
                })

                return models.get(this).op
            }
        }
      , uid: { enumerable: true,
            get: function(){ return models.get(this).uid }
        }
    }
})