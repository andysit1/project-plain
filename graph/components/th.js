import { State } from "./node.js"
import { Transition, TransitionGroup } from "./transition.js" 

class TransitionGroupManager {
    constructor() {
        // Using an object as a HashMap to store transitions
        this.transitions = {};
    }


    //add grp or transition
    addTransitionGRP(state1, state2, transition){
        const key = `${state1.id}-${state2.id}`;
        if ( this.transitions[key] ){
            this.transitions[key].push(transition)
            console.log("added transition")
            return
        }
        
        this.transitions[key] = TransitionGroup(
            state1,
            state2,
            this.transitions = [transition]
        )
        console.log("Made transition group")
        return
    }

    addTransition(nodeIdA, nodeIdB, transition) {
        const key = `${nodeIdA}-${nodeIdB}`;
        if (this.transitions[key]){

        
            this.transitions[key].push(transition)
            console.log(`Transition updated: ${key} ->`, transition);
        }else{

      
            this.transitions[key] = transition;
            console.log(`Transition added: ${key} ->`, transition);
        }
    }

    getTransitionByID(){
        return Object.entries(this.transitions).map(([key, transition]) => (
            console.log(key, transition.type)
        ));
    }
    getTransition(nodeIdA, nodeIdB,) {
        const key = `${nodeIdA}-${nodeIdB}`;
        return this.transitions[key] || null;
    }

    removeTransition(nodeIdA, nodeIdB) {
        const key = `${nodeIdA}-${nodeIdB}`;
        if (this.transitions[key]) {
            delete this.transitions[key];
            console.log(`Transition removed: ${key}`);
        } else {
            console.log(`Transition not found: ${key}`);
        }
    }

    /**
     * Lists all transitions.
     * @returns {Array} An array of all transitions.
     */
    listTransitions() {
        return Object.entries(this.transitions).map(([key, transition]) => ({
            key,
            transition,
        }));
    }
}


// when we create a new node, there needs to be a new group in the manager

// given two states pair them into a single map - > key
    // this makes them into a group of transitions so that the pair of transition should be together to reduce the amount of groups we have
    // since before i would create one every time
    // each state should have another pairing...

// flow 
    // new transition is added
    // if transition key not found then..
        // add new transition group and append the transition
    // else
        // push transition to the returned group

const state1 = new State(
    1, "state1", undefined
)

const state2 = new State(
    2, "state2", undefined
)

// Example usage
const transitionManager = new TransitionGroupManager();

// const t = new Transition("1", "transition 1", state1, state2, transitionManager.getTransition(state1.id, state2.id))

// Adding transitions
transitionManager.addTransition("1", "2", { type: "move", duration: 100 });
transitionManager.addTransition("2", "3", { type: "fade", duration: 200 });

// Retrieving a transition
console.log(transitionManager.getTransition("1", "2")); // { type: "move", duration: 100 }

// Listing all transitions
console.log(transitionManager.listTransitions());

// Removing a transition
transitionManager.removeTransition("1", "2");
console.log(transitionManager.getTransition("1", "2")); // null

console.log("_____")


transitionManager.getTransitionByID()