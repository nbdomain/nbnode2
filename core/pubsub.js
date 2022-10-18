const { createChannel } = require("better-sse")

class PubSub {
    constructor(indexers) {
        this.tickers = {}
        this.indexers = indexers
    }
    subscribe(topic, session) {
        if (!this.tickers[topic]) this.tickers[topic] = createChannel()
        this.tickers[topic].register(session)
    }
    publish(topic, msg, broadcast = true) {
        if (this.tickers[topic]) { //notify subscribers
            this.tickers[topic].broadcast('update', msg)
            return true
        }
        if (broadcast) {
            this.indexers.Nodes.notifyPeers({ cmd: "publish", data: { topic, msg } })
        }
        return false
    }
}
module.exports = PubSub