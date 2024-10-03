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



// Class managing transitions between different game states.
class Machine {
  constructor() {
    this.current = null;
    this.nextLayer = null;
  }

  /**
   * Updates the current state and transitions to the next state if needed.
   */
  update() {
    if (this.nextLayer) {
      this.current = this.nextLayer;
      this.nextLayer = null;
    }
  }
}

//----------
// Handles the graph states -> how we function
const GraphState = {
  IDLE: 'IDLE',
  SELECTING_NODE: 'SELECTING_NODE',
  MAKING_TRANSITION: 'MAKING_TRANSITION',
  EDITING_NODE: 'EDITING_NODE',
  // Add more states as needed
};

// pass this object through objects and it will handle the logic behind scenes
class GraphController {
  constructor() {
      this.state = GraphState.IDLE;
      this.components = []; // Keep track of components to update
  }

  addComponent(component) {
      this.components.push(component);
  }

  setState(newState) {
      this.state = newState;
      console.log(`State changed to: ${this.state}`);
      this.updateComponents(); // Notify components of the state change
  }

  updateComponents() {
      this.components.forEach(component => {
          component.update(this.state);
      });
  }
}
//----------

// Handle the Layering which passes a reference GraphState into the node, toolbar, 
class LayerEngine {
  constructor () {
    this.machine = new Machine()

    //loads the canvas
    const canvas = document.getElementById('graph')
    this.graph = new Graph(canvas)
  
  
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

    this.graph.states.push(stateNode)  
    this.graph.states.push(stateNodeOne)
    this.graph.repaint = true
  

    add_node(this.graph.states)
    add_node(this.graph.states)
    add_node(this.graph.states)
    add_node(this.graph.states)

    //handles the offset and array calcuations ()
    const t_group = new TransitionGroup(stateNode, stateNodeOne)

                          // transition id name, connections state1 connection state2, and layer
    const t = new Transition("1", "transition 1", stateNode, stateNodeOne, t_group)
   
    t_group.transitions.push(t)
    this.graph.transitions.push(t)
    //set first layer
  }


  // i

  encodeTransition(transition) {
    // Encode a transition into a string
    // const { id, name, state1, state2 } = transition;
    // #1,Name
    return `Transition: ${transition.id}|${transition.name}|${transition.parent.id},${transition.child.id}`;
  }

  encodeState(state) {
    // Encode a state into a string
    const { id, name, rect } = state;
    const rectStr = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    return `State: ${id}|${name}|${rectStr}`;
  }

  load_layer(encoded_data) {
    console.log(encoded_data)
  }

  swap_layer() {
    if (!this.machine.nextLayer) {return}

    this.graph.clear()
    this.graph.repaint = true
    this.load_layer("loading encoded data")
  }


  setLayer(encoded_data){

    this()

    console.log(encoded_data)
  }

  display(){
    const stateStrings = this.graph.states.map(state => this.encodeState(state));
    const transitionStrings = this.graph.transitions.map(t => this.encodeTransition(t));
    
    
    console.log("State", stateStrings)
    console.log("Transisitions", transitionStrings)
  }
}

function init(){
    const layerMachine = new LayerEngine()

    layerMachine.display()
}

document.addEventListener('DOMContentLoaded', init);
