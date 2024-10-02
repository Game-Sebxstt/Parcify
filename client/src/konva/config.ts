import type Konva from "konva"
import type { Node, NodeConfig } from "konva/lib/Node"

export const list_id_ignore = ["transformer", "boxShape", "anchorPoint", "textNotAvailable"]

let list_box_groups: Node<NodeConfig>[] = []
let list_groups: Node<NodeConfig>[] = []
let node_selected: Node;
let nodes_selected: Node[] = [];
let bar_element_selected: Node;

export function setNodesSelected(nodes: Node[]){
    nodes_selected = nodes
}

export function setBarElementSelected(element: Node){
    bar_element_selected = element
}

export function setNodeSelected(node: Node){
    node_selected = node
}

export function setBoxGroup(group: Konva.Node){
    list_box_groups.push(group)
}

export function setGroup(group: Konva.Node){
    list_groups.push(group)
}

export function setGroups(groups: Konva.Node[]){
    list_groups = groups
}

export function getNodesSelected(): Konva.Node[]{
    return nodes_selected
}

export function getBarElementSelected(): Konva.Node{
    return bar_element_selected
}

export function getNodeSelected(): Konva.Node{
    return node_selected
}

export function getBoxGroups(){
    return list_box_groups
}

export function getGroups(){
    return list_groups
}

export function getGroup(id: string): Konva.Node{
    return list_groups.find(group => group.id() === id) as Konva.Node
}

export function getBoxGroupOfGroup(group: Konva.Group): Konva.Node{
    return list_box_groups.find(box_group => box_group.id() === group.id()) as Konva.Node
}