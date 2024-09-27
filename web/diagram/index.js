



import Graph from "./components/graph.js"
import { Rect, State } from "./components/node.js"
import { randomInt } from "./utils/nums.js"

const NODE_WIDTH = 150
const NODE_HEIGHT = 75

//let's create a class which holds the target state and represent the 
//connection to toolbar html.. #GOOGLE THIS

//TODO CRUD METHODS , toolbar class?
function add_node(states){
    //create a base nod
    console.log(states)

    let startX = randomInt(0, 400)
    let startY = randomInt(0, 400)

    const rect = new Rect(
      startX,
      startY,
      NODE_WIDTH,
      NODE_HEIGHT
    )
        
    const stateNode = new State(states.length, " Node", rect)
    states.push(stateNode)

}

function delete_node(states){
  let targetStates
  for (const state of states) {
    if (state.isInBounds(x, y)) { targetState = state }
  }
}


function init(){
    console.log("Init Function")
    const canvas = document.getElementById('graph')
    let graph = new Graph(canvas)

    let startX = 400
    let startY = 400

    let originX = 0
    let originY = 0

    const rect = new Rect(
        startX,
        startY,
        NODE_WIDTH,
        NODE_HEIGHT
      )
    

    const rect2 = new Rect(
      originX,
      originY,
      NODE_WIDTH,
      NODE_HEIGHT
    )

    const stateNode = new State(0, "Home", rect)
    const stateNode1 = new State(1, "Origin", rect2)
    stateNode.activeState = true

    graph.states.push(stateNode)  
    graph.states.push(stateNode1)
    graph.repaint = true
  

    add_node(graph.states)
    add_node(graph.states)
    add_node(graph.states)
    add_node(graph.states)
}

document.addEventListener('DOMContentLoaded', init);


