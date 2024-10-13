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
    const previewElement = document.getElementById('propertiespreview'); // Assume an element with id 'preview' in HTML

    if (previewElement && selectedNode) {
        // Update the HTML with information about the selected node
        previewElement.innerHTML = `
            <h3>Node Details</h3>
            <p>ID: ${selectedNode.id}</p>
            <p>Name: ${selectedNode.name}</p>
            <p>Description: ${selectedNode.description}</p>
        `;
    }
}


