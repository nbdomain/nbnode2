const axios = require('axios');
const Arweave = require('arweave');
/*
   
    const variables = {
        tags:
        {
            name: "protocol",
            values: ["nbtest"],
        },
        block: {
            min: 0,
        },
    }
    
    const query = `query Transactions($tags: [TagFilter!], $block: BlockFilter){
            transactions(tags: $tags, block:$block) {
              pageInfo {
                hasNextPage
              }
              edges {
                node {
                  id
                  owner { address }
                  recipient
                  tags {
                    name
                    value
                  }
                  block {
                    height
                    id
                    timestamp
                  }
                  fee { winston }
                  quantity { winston }
                  parent { id }
                }
                cursor
              }
            }
          }`;
    console.log(variables)
    const response = await arweave.api.post('graphql', {
        query,variables
    });
    console.log(response.data);
    */
(async () => {
  console.log(__dirname)
})()