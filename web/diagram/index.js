import Graph from "./components/graph.js"
import { Transition, TransitionGroup } from "./components/transition.js"
import { Rect, State } from "./components/node.js"
import { randomInt } from "./utils/nums.js"



// update this to fit my requirements 
// test wait fake data..



function onConnected (packet) {
  console.log('Bot connected.')

  graph.clear()
  loadNestedGroups(packet)
  loadStates(packet)
  loadTransitions(packet)
  graph.repaint = true
}

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
    const stateNodeOne = new State(1, "Origin", rect2)
    stateNode.activeState = true

    graph.states.push(stateNode)  
    graph.states.push(stateNodeOne)
    graph.repaint = true
  

    add_node(graph.states)
    add_node(graph.states)
    add_node(graph.states)
    add_node(graph.states)

    //handles the offset and array calcuations ()
    const t_group = new TransitionGroup(stateNode, stateNodeOne)

                          // transition id name, connections state1 connection state2, and layer
    const t = new Transition("1", "transition 1", stateNode, stateNodeOne, t_group)
   
    t_group.transitions.push(t)
    graph.transitions.push(t)

}

document.addEventListener('DOMContentLoaded', init);


