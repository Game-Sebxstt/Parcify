import Konva from "konva";
import * as konva from "./KonvaLogic";
import * as req from '../../js/backend/requests'
import * as GlobalFunctions from "./GlobalFunctions";
import * as globals from '../../js/frontend/utilities/globals'

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        
        const stageClone = konva.stage.clone();

        stageClone.getLayers().forEach(layer => {
            if(layer.attrs.id == "layerUtilities"){
                layer.destroy();
            }
        });

        const stageJSON = (stageClone).toJSON();

        localStorage.removeItem("STAGEJSON");
        localStorage.setItem("STAGEJSON", JSON.stringify(stageJSON));
        var dataURL = stageClone.toDataURL({ pixelRatio: 3 });
        req.saveProject(stageJSON, konva.id_stage, dataURL, globals.getCookie("ID-USER"));
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        GlobalFunctions.undo();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        GlobalFunctions.redo();
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'j'){
        e.preventDefault();
        konva.groupElements();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'g') { //Some problemsss
        e.preventDefault();
        konva.ungroupElements();
        konva.saveHistory(konva.stage.toJSON())
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'u'){
        e.preventDefault();

        if(!konva.tr.nodes() > 0){
            return;
        }

        let element = konva.tr.nodes()[0];
        element.moveUp();
        konva.saveHistory(konva.stage.toJSON())
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'o'){
        e.preventDefault();

        if(!konva.tr.nodes() > 0){
            return;
        }

        let element = konva.tr.nodes()[0];
        element.moveDown();
        konva.saveHistory(konva.stage.toJSON())
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if(!konva.getSelectAll()){
            return;
        }

        e.preventDefault();
        const selectedNodes = konva.tr.nodes();
        const copiedNodes = selectedNodes.map(node => node.toObject());
        const copiedData = JSON.stringify(copiedNodes);
        navigator.clipboard.writeText(copiedData);
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'x') {
        if(!konva.getSelectAll()){
            return;
        }
        
        e.preventDefault();
        const selectedNodes = konva.tr.nodes();
        const copiedNodes = selectedNodes.map(node => node.toObject());
        const copiedData = JSON.stringify(copiedNodes);
        navigator.clipboard.writeText(copiedData);
        selectedNodes.forEach(node => {
            konva.layer.getChildren().forEach(item => {
                if(item._id == node.attrs._id){
                    item.destroy();
                }
            });
            node.destroy();
        });


        konva.tr.nodes([]);
        konva.layer.batchDraw();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        if(!konva.getSelectAll()){
            return;
        }

        e.preventDefault();
        navigator.clipboard.readText().then(clipboardData => {
            if (clipboardData) {
                try{
                    let pastedNodes = JSON.parse(clipboardData);
                    const newNodes = pastedNodes.map(nodeData => {
                        const newNode = Konva.Node.create(nodeData, 'container');
                        newNode.setAttrs({
                            x: newNode.x() + (newNode.width() * 2),
                            y: newNode.y() - (newNode.height() / 2),
                        });
                        return newNode;
                    });
                    konva.layer.add(...newNodes);
                    konva.tr.nodes(newNodes);
    
                    konva.setElements([...konva.getElements(), ...newNodes])
                    konva.layer.batchDraw();
                    konva.saveHistory(konva.stage.toJSON())
                }catch(e){
                    console.log("No se pudo pegar.")
                }
            }
        });
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'a'){
        if(!konva.getSelectAll()){
            return;
        }
        
        e.preventDefault();
        konva.tr.nodes([...konva.getElements()]);
    }
});

window.addEventListener('wheel', function(e) {
    e.preventDefault();
}, { passive: false });