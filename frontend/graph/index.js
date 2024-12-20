import Graph from "./components/graph.js"
import { Transition, TransitionGroup } from "./components/transition.js"
import { Rect, State } from "./components/node.js"
import { randomInt } from "./utils/nums.js"
import { GraphManager } from "./components/graph_handler.js"

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



//TODO CRUD METHODS , toolbar class?
function add_transition(transitions){
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


// Handle the Layering which passes a reference GraphState into the node, toolbar
// in truth this class handles the logic of how we update states, transition, and nested
// everything is done in one canvas
class LayerEngine {
  constructor () {
    this.machine = new Machine()
    this.next_layer = this.next_layer.bind(this)
    this.updateLayer = this.updateLayer.bind(this)
    //loads the canvas
    const canvas = document.getElementById('graph')
    this.graph = new Graph(canvas)


    this.layer_incrementer = 0
    this.layers = []
    
  }



  get_layer_index(){
    return this.layer_incrementer % this.layers.length
  }

  get_current_layer(){
    return this.layers[this.get_layer_index()]
  }
  

  updateLayer(){
    const layer = this.get_current_layer()
    console.log(layer)
    layer.updateName()
  }


  //changes the layer index
  next_layer(){
    //clear selections for new layer
    this.graph.reset_selectors()
  
    this.layer_incrementer += 1
    const layer = this.layers[this.get_layer_index()]
    if (layer != undefined){
      //will return the 
      this.load_layer(layer)
    }
  }
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


  load_layer(data) {
    // console.log(data.states)
    // console.log(data.transition)
    // console.log(data.nested_group)

    //change layer variables
    this.graph.states = data.states
    this.graph.transitions = data.transition
    this.graph.nestedGroups = data.nested_group

    //update new layer level
    this.graph.current_layer = this.get_layer_index() + 1
    this.graph.repaint = true
  } 

  swap_layer() {
    if (!this.machine.nextLayer) {return}

    this.graph.clear()
    this.graph.repaint = true
    this.load_layer("loading encoded data")
  }

  // in init, we want to set the amt of layers for the program
  set_layer(layer){
    this.layers.push(layer)
  }

  display(){
    const stateStrings = this.graph.states.map(state => this.encodeState(state));
    const transitionStrings = this.graph.transitions.map(t => this.encodeTransition(t));
    
    console.log("State", stateStrings)
    console.log("Transisitions", transitionStrings)
  }
}
import { TransitionGroupManager } from "./components/th.js"


//layers class will hold states, transitions, and groups
class Layers{
  constructor(states, transition, nest){
    //transition group binding (each layer needs one)
    this.ts_manager = new TransitionGroupManager()

    // variables
    this.states = states
    this.transition = transition
    this.nested_group = nest
  }

  getStateRef(id){
    console.log("Update", id)
    
    this.states.forEach(element => {
      console.log(element.id, id)

      if (element.id == id.trim()){ //why is this not updating my element?
        element.name = document.getElementById("node-name").value
      }
    });
  }

  updateName(){
    const id = document.getElementById("node-id").value
    const to_change = document.getElementById("node-name").value

    this.getStateRef(id)    
  }

  //updateTransitions and updateNestedGroup should be called each time a new transition is added
  updateTransitionsAndNestedGroups(){
    [this.transition, this.nested_group]  = this.ts_manager.listTransitionsAndNestedGroupsInArray()
    this.displayTransitions()
  }

  displayTransitions(){
    console.log(this.transition)
    console.log(this.nested_group)
  }

}

function init(){

    const layer1_states = []
    add_node(layer1_states)
    add_node(layer1_states)
    add_node(layer1_states)
    add_node(layer1_states)
    const layer2_states = []
    add_node(layer2_states)
    add_node(layer2_states)

    const layer3_states = []
    add_node(layer3_states)

    let layer1 = new Layers(
      layer1_states,
      [],
      [],
    )

    let layer2 = new Layers(
      layer2_states,
      [],
      [],
    )

    let layer3 = new Layers(
      layer3_states,
      [],
      [],
    )

    const layerMachine = new LayerEngine()
    const graphManager = new GraphManager(layerMachine);

    
    //this has to be set through api push
    layerMachine.layers = [layer1, layer2, layer3]
    layerMachine.load_layer(layer1)
      
    // Attach class methods to event listeners
    document.getElementById('addnote-btn').addEventListener('click', graphManager.addNode);
    document.getElementById('deletenote-btn').addEventListener('click', graphManager.deleteNode);
    document.getElementById('cleargraph-btn').addEventListener('click', graphManager.clearGraph);
    document.getElementById('save-btn').addEventListener('click', graphManager.saveGraph);
    document.getElementById('addtrans-btn').addEventListener('click', graphManager.makeTransitions);
    document.getElementById('swaplayer-btn').addEventListener('click', layerMachine.next_layer);
    document.getElementById('update-state').addEventListener('click', layerMachine.updateLayer)

}

// Make the DIV element draggable:
dragElement(document.getElementById("mydiv"));

function dragElement(elmnt) {
  var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  if (document.getElementById(elmnt.id + "header")) {
    // if present, the header is where you move the DIV from:
    document.getElementById(elmnt.id + "header").onmousedown = dragMouseDown;
  } else {
    // otherwise, move the DIV from anywhere inside the DIV:
    elmnt.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
  // get the mouse cursor position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // call a function whenever the cursor moves:
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    // calculate the new cursor position:
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // set the element's new position:
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    // stop moving when mouse button is released:
    document.onmouseup = null;
    document.onmousemove = null;
  }
}


document.addEventListener('DOMContentLoaded', init);
