const config = require('./config')
const axios = require('axios')
let node = null
class Nodes{
    async selectNode(nodes,count=1){
        return new Promise(resolve=>{
            let i=1,selected_nodes=[]
            for(const node of nodes){
                axios.get(node+"/api/p2p/ping").then(res=>{
                    if(res.data&&res.data.msg=="pong"){
                        selected_nodes.push(node)
                        ++i
                    }
                }).catch(e=>{
                    console.log(e)
                })
                if(i>count)break;
            }
            resolve(selected_nodes.length==0?[]:selected_nodes)
        })
    }
    async init(){
        this.endpoint = (config.CONFIG.node_info.https?"https://":"http://")+config.CONFIG.node_info.domain+":"+config.CONFIG.node_info.port
        setTimeout(this.refreshPeers.bind(this),5000)
        return node
    }
    async refreshPeers(){
        const port = config.CONFIG.node_info.port
        const res = await axios.get("http://localhost:"+port+"/api/queryKeys?tags=nbnode")
        let peers2test=[]
        if(res.data){
            //peers2test = res.data
        }
        if(config.CONFIG.peers.length)
            peers2test  = peers2test.concat(config.CONFIG.peers)
        this.peers = await this.selectNode(peers2test,50)
        console.log(`found ${this.peers.length} peers`)
        
        setTimeout(this.refreshPeers.bind(this),60000)
    }
    async notifyPeers({cmd,data}){
        for (const peer of this.peers) {
            const url = peer+"/p2p/"+cmd+"?data="+data+"&&from="+this.endpoint
            axios.get(url)
        }
    }
    static Instance(){
        if(node==null){
            node = new Nodes
        }
        return node
    }
}
module.exports = Nodes.Instance()