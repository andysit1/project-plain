import { State } from "./node.js"
import { Transition, TransitionGroup } from "./transition.js" 
import { PairHashMap } from "./utils/hashmap.js"



export class TransitionGroupManager {
    constructor() {
        // Using an object as a HashMap to store transitions
        this.transitions = {};
        this.transitions_map = new PairHashMap()
    }

    getTransitionsList(){
    }



    getNestedGroupList(){
    }

    //get elements
    display(){
        console.log("____")
        console.log(this.transitions_map.list())
        console.log("____")

    }

    //returns the transition grp 
    getTransitionGroup(state1, state2){
        const grp = this.transitions_map.get(state1.id, state2.id)
        if (grp != undefined){
            return grp
        }

        //if not return, it means that grp is undefined
        const t_group = new TransitionGroup(
            state1,
            state2,
            []
        )
        this.transitions_map.set(state1.id, state2.id, t_group)
        return t_group

    }

    addTransition(state1, state2, transition){
        const grp = this.transitions_map.get(state1.id, state2.id) // t_grp or undefined
        if (grp != undefined){
            console.log("added transition to group")
            grp.transitions.push(transition)
        }else{
            const t_group = TransitionGroup(
                state1,
                state2,
                [transition]
            )

            this.transitions_map.set(state1.id, state2.id, t_group)
            console.log("set new t_group")
        }
    }


    getTransitionByID(){
        return Object.entries(this.transitions).map(([key, transition]) => (
            console.log(key, transition.type)
        ));
    }

    getTransitioArray(state1, state2,) {
        return this.transitions_map.get(state1.id, state2.id) | []
    }


    //rewrite not sure how
    removeTransition(nodeIdA, nodeIdB) {
        const key = `${nodeIdA}-${nodeIdB}`;
        if (this.transitions[key]) {
            delete this.transitions[key];
            console.log(`Transition removed: ${key}`);
        } else {
            console.log(`Transition not found: ${key}`);
        }
    }

    listStateTransition(){
        return Object.entries(this.transitions_map.map).map(([key, grp]) => ({
            state : key,
            transitions: grp,
        }));
    }

    /**
     * Lists all transitions.
     * @returns {Array} An array of all transitions.
     */
    listTransitionsDict() {
        return Object.entries(this.transitions_map.map).map(([key, grp]) => ({
            grp : grp,
            transitions: grp.transitions ? grp.transitions : [],
        }));
    }

    listTransitionsAndNestedGroupsInArray(){
        let tmpTransition = []
        let tmpNested = []
       
        Object.entries(this.transitions_map.map).forEach(([key, grp]) => {
            tmpTransition.push(grp.transitions);  // Push the transitions array
            tmpNested.push(grp);                  // Push the group itself
        })

        return [tmpTransition.flat(), tmpNested.flat()]
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

// const state1 = new State(
//     1, "state1", undefined
// )

// const state2 = new State(
//     2, "state2", undefined
// )


// const state3 = new State(
//     3, "state3", undefined
// )

// const state4 = new State(
//     4, "state4", undefined
// )


// //this is a sample of how the function will look in the real system
// function createTransition(state1, state2){
//     if (state1 == state2){
//         //should not be able to create transition between each other
//         return
//     }

//     //define a new transition with the given properties
//     const t = new Transition(
//         1,
//         "a auto transitions",
//         state1,
//         state2,
//         transitionManager.getTransitionGroup(state1, state2)
//     )
    
//     //passing the state1 and state2 is redundant, as it's already in t
//     transitionManager.addTransition(state1, state2, t)
// }

// // Example usage
// const transitionManager = new TransitionGroupManager();

// //the power of the transition Manager is that now we dont need to link the groups together
// // we can fetch the group through the transition manager
// // next up make the id just the length of the total size of transitions 
// // reduce the params to just the name of transition...

// createTransition(state1, state2)
// createTransition(state3, state4)
// createTransition(state4, state3)
// createTransition(state1, state4)
// createTransition(state4, state1)

// console.log("_________")
// console.log("Transition List")


// const list_trans = transitionManager.listTransitionsDict()
// console.log(list_trans)

// console.log("_________")

// console.log("listTransitionsAndNestedGroupsInArray List -> [transitions, nested]")

// var transition = [];
// var nested_group = [];

// [transition, nested_group] = transitionManager.listTransitionsAndNestedGroupsInArray()

// console.log(transition)
// console.log(nested_group)