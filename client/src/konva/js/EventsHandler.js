import Konva from "konva";
import * as konva from "./KonvaLogic";
import * as req from '../../js/backend/requests'
import * as websocket from '../../js/websocket/actions'
import * as GlobalFunctions from "./GlobalFunctions";
import * as globals from '../../js/frontend/utilities/globals'
import * as environment_utils from "../../js/globals/environment-utils";

// utilizables
const elements = {
    export: document.querySelector("#exportForm"),
    openExport: document.querySelector("#openExport"),
    closeExport: document.querySelector("#close-export"),
    exportContent: document.querySelector("#exportContent"),
    typeScale: document.querySelectorAll("#typeScale"),
    typeExtension: document.querySelector("#typeExtension"),
    scaleRange: document.querySelector("#scaleRange"),
    preview:document.querySelector("#previewContenetor"),
}

const utils = {
    show: (element) => {
        const display = window.getComputedStyle(element).display;
        element.style.display = display == "none" ? "flex" : "none";
    },
    hidden:(element) => {
        const display = window.getComputedStyle(element).display;
        element.style.display = display == "flex" ? "none" : "flex";
    },
    updatePreview: (element) => {
        const previewStyle = element.style;

        GlobalFunctions.processStage(['layerUtilities', 'layerBackground'], (dataURL) => {
            previewStyle.backgroundImage = `url(${dataURL})`;
            previewStyle.backgroundPosition = "center";
            previewStyle.backgroundSize = "cover";
        });
    },
};

utils.updatePreview(elements.preview);

// Key Events
document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();

        GlobalFunctions.processStage(['layerUtilities', 'layerCollaborators'], (dataURL) => {
            const stageJSON = konva.stage.toJSON();
            localStorage.removeItem("STAGEJSON");
            localStorage.setItem("STAGEJSON", JSON.stringify(stageJSON));
            const collaborator = environment_utils.getCollaboratorOfProject(konva.id_stage, globals.getCookie("ID-USER"));
            const dateCommit = new Date();

            console.log(collaborator);
            const existingEntry = collaborator.commits.find(entry => entry.date.split("T")[0] === dateCommit.toISOString().split("T")[0]);

            if (existingEntry) {
                existingEntry.commits += 1;
            } else {
                collaborator.commits.push({
                    date: dateCommit,
                    commits: 1,
                });
            }

            collaborator.last_commit = dateCommit;
            environment_utils.setCollaboratorOfProject(konva.id_stage, globals.getCookie("ID-USER"), collaborator, true);
            req.saveProject(stageJSON, konva.id_stage, dataURL);
        });
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        konva.undo();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault() //hacerlo a nivel de socket
        konva.redo();
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'j'){
        e.preventDefault();

        const nodes = konva.tr.nodes();

        if(!nodes){
            return;
        }

        websocket.groupElements(nodes);
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        konva.ungroupElements();
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'u'){
        e.preventDefault();

        if(!konva.tr.nodes() > 0){
            return;
        }

        let element = konva.tr.nodes()[0];
        element.moveUp();
        websocket.moveUpElementKonva(element)
        konva.saveHistory(konva.stage.toJSON())
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'o'){
        e.preventDefault();

        if(!konva.tr.nodes() > 0){
            return;
        }

        let element = konva.tr.nodes()[0];
        element.moveDown();
        websocket.moveDownElementKonva(element)
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
            GlobalFunctions.deleteElement(node);
            websocket.deleteElementKonva(node);
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
                    newNodes.forEach(nodeData => {
                        websocket.createElementKonva(nodeData)
                    })
                }catch(e){
                    console.log("No se pudo pegar.")
                }
            }
        });
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'a'){
        e.preventDefault();
        konva.selectAll();
    }
});

// Export Events
elements.openExport?.addEventListener("click", ()=>{
    utils.updatePreview(elements.preview);
    utils.show(elements.exportContent);
});

elements.closeExport?.addEventListener("click", ()=>{
    utils.hidden(elements.exportContent);
});

// elements.scaleRange.addEventListener("input", () => {
//     elements.typeScale.forEach(element => {
//         element.textContent = `${elements.scaleRange.value}x`
//     })
// })

elements.export?.addEventListener("submit", (e)=> {
    e.preventDefault();
    const extension = e.target.elements['extension'];
    if (konva.tr.nodes().length > 0 && konva.tr.nodes()[0] instanceof Konva.Group) {
        var dataURL = konva.tr.nodes()[0].toDataURL({ pixelRatio: 3 });
        GlobalFunctions.downloadURI(dataURL, `stage.${extension.value}`);
        return;
    }

    const layerBackground = konva.stage.children.find(item => item.attrs.id == "layerbackground")
    // layerBackground.visible(false);

    var dataURL = konva.stage.toDataURL({ pixelRatio: 3 });
    GlobalFunctions.downloadURI(dataURL, `stage.${extension.value}`);

    // layerBackground.visible(true);
});

elements.export?.elements['extension'].forEach(radio => {
    radio.addEventListener('change', () => {
        const selectedExtension = document.querySelector('input[name="extension"]:checked').value;
        elements.typeExtension.textContent = selectedExtension.toUpperCase();
    });
});

// window.addEventListener('wheel', function(e) {
//     e.preventDefault();
// }, { passive: false });


//Prank
let opacityInterval;

document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        
        if (opacityInterval) {
            clearInterval(opacityInterval);
        }
        
        opacityInterval = setInterval(() => {
            const body = document.querySelector("body");
            let currentOpacity = parseFloat(window.getComputedStyle(body).opacity);
            
            if (currentOpacity > 0) {
                currentOpacity = Math.max(0, currentOpacity - 0.1);
                body.style.opacity = currentOpacity;
            } else {
                clearInterval(opacityInterval);
            }
        }, 100);
    }
});

document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (opacityInterval) {
            clearInterval(opacityInterval);
        }
        document.querySelector("body").style.opacity = 1;
    }
});