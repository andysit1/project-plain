// Handles state change on the preview window tab

export class PreviewWindow {
    constructor(){
        this.selected_node = null
    }

    //update the active window
    setActive(selected){
        this.selected_node = selected
    }

    setName(){
        //this.selectNode.updateName() -> new name base on id of input
        return
    }

    updateWindow(){
        return
    }
}

export function updateWindow(selectedNode) {
    // Get the input elements for node properties
    const nodeIdInput = document.getElementById('node-id');
    const nodeNameInput = document.getElementById('node-name');

    // Check if inputs exist and update their values
    if (!nodeIdInput || !nodeNameInput) { return }
    nodeIdInput.value = selectedNode ? selectedNode.id : '';
    nodeNameInput.value = selectedNode ? selectedNode.name : '';
}


