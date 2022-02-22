const config = require('./config').CONFIG
const axios = require('axios')
const rwc = require("random-weighted-choice")
let node = null
class Nodes {
    constructor() {
        this.nodes = []
    }
    async sleep(seconds) {
        return new Promise(resolve => {
            setTimeout(resolve, seconds * 1000);
        })
    }
    async selectNode(nodes, count = 1) {
        return new Promise(async resolve => {
            let i = 1, selected_nodes = [], j = 1;
            for (const node of nodes) {
                axios.get(node + "/api/p2p/ping").then(res => {
                    if (res.data && res.data.msg == "pong") {
                        selected_nodes.push(node)
                        ++i
                    }
                }).catch(e => {
                    console.log(e)
                }).finally(() => j++)
            }
            while (i <= count && j <= nodes.length) {
                await this.sleep(1)
            }
            resolve(selected_nodes.length == 0 ? [] : selected_nodes)
        })
    }
    get() {
        const node = rwc(this.nodes)
        //log("choose:",node)
        return node
    }
    cool(url) {
        const node = this.nodes.find(node => node.id == url)
        if (node) {
            node.weight--
        }
    }
    warm(url) {
        const node = this.nodes.find(node => node.id == url)
        if (node) {
            node.weight++
        }
    }
    async init() {
        this.endpoint = (config.node_info.https ? "https://" : "http://") + config.node_info.domain
        if (!config.node_info.https) this.endpoint += ":" + config.node_info.port
        this.refreshPeers(true)
        return true
    }
    async refreshPeers(onlyLocal=false) {
        const port = config.node_info.port
        let peers2test = []
        if(!onlyLocal){
            try {
                const res = await axios.get("http://localhost:" + port + "/api/queryKeys?tags=nbnode")
                if (res.data && res.data.length > 0) {
                    //peers2test = res.data
                }
            } catch (e) {}
        }
        if (config.peers.length)
            peers2test = peers2test.concat(config.peers)
        peers2test = peers2test.filter(item => item.indexOf(config.node_info.domain) == -1)
        //this.peers = await this.selectNode(peers2test,50)
        for (const node of peers2test) {
            if (this.nodes.find(item => item.id == node)) continue;
            console.log("Adding node:",node)
            this.nodes.push({ id: node, weight: 50 })
        }
        //console.log(`found ${this.peers.length} peers`)

        setTimeout(this.refreshPeers.bind(this), 60000)
    }
    getNodes() {
        return this.nodes
    }
    async notifyPeers({ cmd, data }) {
        for (const peer of this.nodes) {
            const url = peer + "/api/p2p/" + cmd + "?data=" + (data) + "&&from=" + (this.endpoint)
            try {
                axios.get(url)
            } catch (e) {
                console.log("error getting: ", url)
            }
        }
    }
    static Instance() {
        if (node == null) {
            node = new Nodes
        }
        return node
    }
}
module.exports = Nodes.Instance()