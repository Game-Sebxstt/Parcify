import Konva from 'konva';
import * as GlobalFunctions from "../../js/GlobalFunctions";
import * as konva from "../../js/KonvaLogic";
import { CustomArrow } from '../shapes/CustomArrow';

interface ConnectorOptions {
    enabledAnchors?: string[];
    anchorSize?: number;
    borderColor?: string;
    anchorColor?: string;
    arrowColor?: string;
    borderArrowColor?: string;
    proximityThreshold?: number;
}

export class TransformerPoints {
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private layerUtilities: Konva.Layer;
    private targetNode: Konva.Node | null = null;
    private options: ConnectorOptions;
    private isDragging: boolean = false;
    private anchors: Konva.Circle[] = [];
    private transforms: TransformerPoints[] = [];
    public separationOffset = 20;
    private initialAnchorPosition: { x: number, y: number } = { x: 0, y: 0 };
    private activeAnchorType: string | null = null;
    private arrowMap: { [key: string]: Konva.Arrow[] } = {};
    private arrowCustom: any;
    private scale: number = 1;
    private updateArrowsScheduled: boolean = false;
    private updateAnchorsScheduled: boolean = false;

    constructor(stage: Konva.Stage, layer: Konva.Layer, layerUtilities: Konva.Layer, options?: ConnectorOptions) {
        this.stage = stage;
        this.layer = layer;
        this.layerUtilities = layerUtilities
        this.options = options || {
            enabledAnchors: ['left', 'right', 'bottom', 'top'],
            anchorSize: 7,
            borderColor: '#80D0FF',
            anchorColor: 'white',
            arrowColor: 'white',
        };

        this.addGlobalEvents();
        this.addStageZoomListener();
        this.updateScale();
    }

    private addGlobalEvents() {
        this.stage.on('click', (e) => {
            if (!this.targetNode || !e.target || e.target === this.targetNode) return;
            this.detach();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.detach();
            }
        });
    }

    private addStageZoomListener() {
        // this.stage.on('transform', () => this.handleZoomOrTransform());
        // this.stage.on('wheel', () => this.handleZoomOrTransform());
    }

    private handleZoomOrTransform() {
        if (!this.targetNode) {
            konva.getElements().forEach((element: Konva.Node) => {
                if(element instanceof Konva.Rect || element instanceof Konva.RegularPolygon){
                    this.targetNode = element;
                    this.updateScale();
                    this.updateAnchors();
                    this.updateArrows();
                    this.layer.batchDraw();
                }
            });

            return;
        }
        
        this.updateScale();
        this.updateAnchors();
        this.updateArrows();
        this.layer.batchDraw();
    }

    private updateScale() {
        this.scale = this.stage.scaleX() > 0.3 ? this.stage.scaleX() : 0.3;
        this.scale = this.scale < 5 ? this.scale : 5;
        this.separationOffset = 20 / this.scale; 
    }

    private notIsRect(node: Konva.Node): boolean {
        return node.getClassName() === 'Circle' || node.getClassName() === 'RegularPolygon' || node.getClassName() === 'Diamond';
    }

    private getNodeDimensions(node: Konva.Node): { width: number, height: number } {
        if (this.notIsRect(node)) {
            const circle = node as Konva.Circle;
            const diameter = circle.radius() * 2;
            return { width: diameter, height: diameter };
        } else {
            return { width: node.width(), height: node.height() };
        }
    }

    private getAnchorPositions(elementNode: Konva.Node | null) {
        if (!elementNode || !this.targetNode) return {};

        const { width, height } = this.getNodeDimensions(this.targetNode);
        const scaleX = elementNode.scaleX();
        const scaleY = elementNode.scaleY();

        let anchorPositions: { [key: string]: { x: number, y: number } } | null = null;

        if (!this.notIsRect(this.targetNode)) {
            anchorPositions = {
                'left': { x: -this.separationOffset, y: height * scaleY / 2 },
                'right': { x: width * scaleX + this.separationOffset, y: height * scaleY / 2 },
                'bottom': { x: width * scaleX / 2, y: height * scaleY + this.separationOffset },
                'top': { x: width * scaleX / 2, y: -this.separationOffset }
            };
        }else{
            anchorPositions = {
                'left': { x: -width * scaleX / 2 - this.separationOffset, y: 0 },
                'right': { x: width * scaleX / 2 + this.separationOffset, y: 0 },
                'bottom': { x: 0, y: height * scaleY / 2 + this.separationOffset },
                'top': { x: 0, y: -height * scaleY / 2 -this.separationOffset }
            };
        }

        return anchorPositions;
    }

    private addNodeEvents() {
        if (!this.targetNode) return;

        this.targetNode.on('transform dragmove', (e) => {
            this.targetNode = e.target
            this.updateAnchors();
            this.updateArrows();
            this.layer.batchDraw();
        });
    }

    private onAnchorDragStart(e: Konva.KonvaEventObject<DragEvent>, anchor: Konva.Circle) {
        if (!this.targetNode) return;
    
        this.isDragging = true;
        (document.querySelector("#BarTool") as HTMLDivElement).style.opacity = "0";
        this.activeAnchorType = anchor.name();
    
        const startX = anchor.x();
        const startY = anchor.y();
        this.initialAnchorPosition = { x: startX, y: startY };
    
        const mousePos = this.stage.getRelativePointerPosition();
        if (!mousePos) return;
    
        this.arrowMap[this.activeAnchorType || '']?.forEach(arrow => arrow.destroy());
        this.arrowMap[this.activeAnchorType || ''] = [];

        konva.getElements().forEach((element: Konva.Node) => {
            if (element === this.targetNode || (
                element instanceof Konva.Rect == false &&
                element instanceof Konva.Circle == false &&
                element instanceof Konva.RegularPolygon == false &&
                element instanceof Konva.Group == false
            )) return;
    
            if (!element.attrs.transformerTarget) {
                if (element instanceof Konva.Group){
                    element.getChildren().forEach((child: Konva.Node) => {
                        if (child instanceof Konva.Rect || child instanceof Konva.Circle || child instanceof Konva.RegularPolygon){
                            if (!child.attrs.transformerTarget) {
                                const transformer = new TransformerPoints(this.stage, this.layer, this.layerUtilities, this.options);
                                child.setAttrs({ transformerTarget: transformer });
                            }
                    
                            const transformer = child.attrs.transformerTarget as TransformerPoints;
                            transformer.attachTo(child);
                            this.transforms.push(transformer);
                        }
                    })
                }else{
                    const transformer = new TransformerPoints(this.stage, this.layer, this.layerUtilities, this.options);
                    element.setAttrs({ transformerTarget: transformer });
                }
            }
    
            if(element.attrs.transformerTarget){
                const transformer = element.attrs.transformerTarget as TransformerPoints;
                transformer.attachTo(element);
                this.transforms.push(transformer);
            }
    
            // const arrow = new Konva.Arrow({
            //     points: [startX, startY, mousePos.x, mousePos.y],
            //     pointerLength: 10 / this.scale,
            //     pointerWidth: 10 / this.scale,
            //     fill: this.options.arrowColor || 'white',
            //     stroke: this.options.borderArrowColor || 'white',
            //     strokeWidth: 2 / this.scale,
            //     lineJoin: "round",
            //     lineCap: "round",
            //     draggable: false,
            //     listening: false,
            //     name: 'arrow',
            // });

            const options = {
                points: [startX, startY, mousePos.x, mousePos.y],
                fill: this.options.arrowColor || 'white',
                stroke: this.options.borderArrowColor || 'white',
                pointerLength: 10 / this.scale,
                pointerWidth: 10 / this.scale,
                strokeWidth: 2 / this.scale,
            }

            this.arrowCustom = new CustomArrow(options, this.layer, this.stage);

            const arrow = this.arrowCustom.getArrow();

            arrow.setAttr('anchorA', this.targetNode)
            arrow.setAttr("anchorIdA", this.targetNode?.attrs.id_unique)
            arrow.setAttr('anchorTypeA', this.activeAnchorType)
    
            this.layer.add(arrow);
            this.arrowMap[this.activeAnchorType || ''].push(arrow);
        });

        this.layer.batchDraw();
    }

    private onAnchorDrag(e: Konva.KonvaEventObject<DragEvent>, anchor: Konva.Circle) {
        if (!this.isDragging || !this.activeAnchorType) return;
    
        const mousePos = this.stage.getRelativePointerPosition();
        if (!mousePos) return;
    
        this.arrowMap[this.activeAnchorType || '']?.forEach(arrow => {
            const startPos: { x: number, y: number } = this.initialAnchorPosition
            const endPos = mousePos;
            const middlePos = this.calculateMiddlePosition(startPos, endPos, this.activeAnchorType || '');

            this.arrowCustom.updateAnchors(middlePos, endPos, startPos);

            arrow.points([startPos.x, startPos.y, middlePos.x, middlePos.y, endPos.x, endPos.y]);
        });
    
        this.updateAnchors();
        this.updateArrows();
        this.layer.batchDraw();
    }
    
    private onAnchorDragEnd(e: Konva.KonvaEventObject<DragEvent>, anchor: Konva.Circle) {

        this.isDragging = false;
    
        const mousePos = this.stage.getRelativePointerPosition();
        if (!mousePos || !this.activeAnchorType) return;
    
        const { targetAnchor, targetClosest } = this.findClosestAnchor(mousePos);

        targetClosest?.on("dragstart", (e) => {
            this.targetNode = e.target
        })

        targetClosest?.on("dragmove", () => {
            this.updateArrows();
            this.layer.batchDraw();
        })

        targetClosest?.on("transform", (e) => {
            this.targetNode = e.target
            this.updateArrows();
            this.layer.batchDraw();
        })
    
        if (targetAnchor) {
            this.arrowMap[this.activeAnchorType || '']?.forEach(arrow => {
                const startPos = {x: this.initialAnchorPosition.x, y: this.initialAnchorPosition.y}
                const endPos = {x: targetAnchor.x(), y: targetAnchor.y()}
                const middlePos = this.calculateMiddlePosition(startPos, endPos, this.activeAnchorType || '');

                arrow.points([startPos.x, startPos.y, middlePos.x, middlePos.y, endPos.x, endPos.y]);
                arrow.setAttr("anchorB", targetClosest)
                arrow.setAttr("anchorIdB", targetClosest?.attrs.id_unique)
                arrow.setAttr('anchorTypeB', targetAnchor.name());
            });

            this.arrowCustom.initAnchors();
        } else {
            this.arrowMap[this.activeAnchorType || '']?.forEach(arrow => arrow.destroy());
            delete this.arrowMap[this.activeAnchorType || ''];
            this.arrowCustom.destroyAnchors();
        }

        konva.getElements().forEach((element: Konva.Node) => {
            if (element === this.targetNode || (
                element instanceof Konva.Rect == false &&
                element instanceof Konva.Circle == false &&
                element instanceof Konva.RegularPolygon == false && 
                element instanceof Konva.Group == false
            )) return;
    
            if(element instanceof Konva.Group){
                element.getChildren().forEach((child: Konva.Node) => {
                    if (child instanceof Konva.Rect || child instanceof Konva.Circle || child instanceof Konva.RegularPolygon){
                        const transformer = child.attrs.transformerTarget as TransformerPoints;
                        transformer.detach();
                    }
                })
            }else{
                const transformer = element.attrs.transformerTarget as TransformerPoints;
                transformer.detach();
            }
        })
    
        this.activeAnchorType = null;
        this.layer.batchDraw();
    }

    private findClosestAnchor(mousePos: { x: number, y: number }): { targetAnchor: Konva.Circle | null, targetClosest: Konva.Node | null } {
        const proximityThreshold = this.options.proximityThreshold || 15;
        let targetAnchor: Konva.Circle | null = null;
        let minDistance = Infinity;
        let targetNodeTranform: Konva.Node | null = null;
    
        this.transforms.forEach(transformer => {
            transformer.anchors.forEach(anchor => {
                const dist = Math.sqrt(Math.pow(anchor.x() - mousePos.x, 2) + Math.pow(anchor.y() - mousePos.y, 2));
                if (dist < proximityThreshold && dist < minDistance) {
                    targetAnchor = anchor;
                    minDistance = dist;
                    targetNodeTranform = transformer.targetNode as Konva.Node;
                }
            });
        });
    
        return { targetAnchor, targetClosest: targetNodeTranform };
    }

    private updateAnchors() {
        if (this.updateAnchorsScheduled) return;
        this.updateAnchorsScheduled = true;
    
        requestAnimationFrame(() => {
            if (!this.targetNode) return;
    
            const anchorPositionsTarget = this.getAnchorPositions(this.targetNode);
            const snapRotation = konva.tr;
    
            this.anchors.forEach(anchor => {
                const anchorType = anchor.name();
                const pos = anchorPositionsTarget[anchorType];
                if (pos) {
                    anchor.setAttrs({
                        x: (this.targetNode?.x() || 0) + pos.x,
                        y: (this.targetNode?.y() || 0) + pos.y,
                        radius: (this.options.anchorSize || 7) / this.scale,
                        strokeWidth: 2 / this.scale,
                    });
                }
            });
    
            this.updateAnchorsScheduled = false;
            this.layer.batchDraw();
        });
    }

    private updateArrows() {
        if (this.updateArrowsScheduled) return;
        this.updateArrowsScheduled = true;
    
        requestAnimationFrame(() => {
            if (!this.targetNode) return;
    
            Object.keys(this.arrowMap).forEach(anchorType => {
                this.arrowMap[anchorType]?.forEach(arrow => {
                    const anchorA = arrow.getAttr("anchorA");
                    const anchorTypeA = arrow.getAttr("anchorTypeA");
                    const anchorB = arrow.getAttr("anchorB");
                    const anchorTypeB = arrow.getAttr("anchorTypeB");
                    
                    if (!anchorA || !anchorB) return;
    
                    const startPos = this.calculateArrowPosition(anchorA, anchorTypeA);
                    const endPos = this.calculateArrowPosition(anchorB, anchorTypeB);
                    const middlePos = this.calculateMiddlePosition(startPos, endPos, anchorTypeA);
    
                    arrow.points([startPos.x, startPos.y, middlePos.x, middlePos.y, endPos.x, endPos.y]);
                    arrow.setAttrs({
                        pointerLength: 10 / this.scale,
                        pointerWidth: 10 / this.scale,
                        strokeWidth: 2 / this.scale,
                    });
                });
            });
    
            this.updateArrowsScheduled = false;
            this.layer.batchDraw();
        });
    }

    private calculateArrowPosition(anchor: Konva.Node, anchorType: string) {
        const { width, height } = this.getNodeDimensions(anchor);
        let position: { x: number, y: number } = { x: anchor.x(), y: anchor.y() };

        switch (anchorType) {
            case 'left':
                if (this.notIsRect(anchor)) {
                    position.x -= width * anchor.scaleX() / 2 + this.separationOffset;
                    position.y = anchor.y();
                }else{
                    position.x -= this.separationOffset;
                    position.y += height * anchor.scaleY() / 2;
                }
                break;
            case 'right':
                if (this.notIsRect(anchor)) {
                    position.x += width * anchor.scaleX() / 2 + this.separationOffset;
                    position.y = anchor.y();
                }else{
                    position.x += width * anchor.scaleX() + this.separationOffset;
                    position.y += height * anchor.scaleY() / 2;
                }
                break;
            case 'top':
                if(this.notIsRect(anchor)){
                    position.x = anchor.x();
                    position.y -= height * anchor.scaleY() / 2 + this.separationOffset;
                }else{
                    position.x += width * anchor.scaleX() / 2;
                    position.y -= this.separationOffset;
                }
                break;
            case 'bottom':
                if(this.notIsRect(anchor)){
                    position.x = anchor.x();
                    position.y += height * anchor.scaleY() / 2 + this.separationOffset;
                }else{
                    position.x += width * anchor.scaleX() / 2;
                    position.y += height * anchor.scaleY() + this.separationOffset;
                }
                break;
        }

        return position;
    }
    
    private calculateMiddlePosition(startPos: {x: number, y: number}, endPos: {x: number, y: number}, anchorTypeA: string): {x: number, y: number} {
        let middleX, middleY;
        const heightDifference = endPos.y - startPos.y;
        const widthDifference = endPos.x - startPos.x;
    
        if (anchorTypeA === 'left' || anchorTypeA === 'right') {
            if (Math.abs(heightDifference) > Math.abs(widthDifference)) {
                middleX = startPos.x + widthDifference ;
                middleY = startPos.y;
            } else {
                middleX = startPos.x;
                middleY = endPos.y;
            }
        } else {
            if (Math.abs(widthDifference) > Math.abs(heightDifference)) {
                middleX = startPos.x;
                middleY = startPos.y + heightDifference ;
            } else {
                middleX = endPos.x;
                middleY = startPos.y;
            }
        }
    
        return {x: middleX, y: middleY};
    }

    public attachTo(node: Konva.Node) {
        if (!node || node.attrs.id === "anchorPoint") return;

        this.targetNode = node;
        this.addNodeEvents();

        this.anchors.forEach(anchor => anchor.destroy());
        this.anchors = [];

        const anchorPositions = this.getAnchorPositions(this.targetNode);

        this.options.enabledAnchors?.forEach((anchorType) => {
            const pos = anchorPositions[anchorType];
            if (pos) {
                const anchor = new Konva.Circle({
                    x: (this.targetNode?.x() || 0) + pos.x,
                    y: (this.targetNode?.y() || 0) + pos.y,
                    radius: (this.options.anchorSize || 7) / this.scale,
                    fill: this.options.anchorColor || 'white',
                    stroke: this.options.borderColor || '#80D0FF',
                    strokeWidth: 2 / this.scale,
                    name: anchorType,
                    id: "anchorPoint",
                    id_unique: GlobalFunctions.randomId(),
                    draggable: true,
                });

                anchor.on('dragstart', (e) => this.onAnchorDragStart(e, anchor));
                anchor.on('dragmove', (e) => this.onAnchorDrag(e, anchor));
                anchor.on('dragend', (e) => this.onAnchorDragEnd(e, anchor));

                this.anchors.push(anchor);
                this.layerUtilities.add(anchor);
            }
        });

        this.targetNode?.setAttrs({ transformer: this });
        this.layerUtilities.batchDraw();
    }

    public detach() {
        this.anchors.forEach(anchor => anchor.destroy());
        this.anchors = [];
        this.targetNode = null;

        konva.getElements().forEach((element: Konva.Node) => {
            if (element.attrs.id === "anchorPoint") {
                element.destroy();
            }
        });

        this.layer.batchDraw();
    }

    public init() {
        var arrowMapClone: any = {};

        this.layer.find('.arrow').forEach(arrow => {
            const anchorTypeA = arrow.attrs.anchorTypeA;

            if (!arrowMapClone[anchorTypeA]) {
                arrowMapClone[anchorTypeA] = [];
            }

            arrowMapClone[anchorTypeA].push(arrow);
        });

        this.arrowMap = arrowMapClone;

        Object.keys(this.arrowMap).forEach((anchorType) => {
            this.arrowMap[anchorType].forEach(arrow => {
                if(arrow.getAttr("anchorA") || arrow.getAttr("anchorB")) return;

                let anchorA
                let anchorB

                this.layer.getChildren().forEach((element: Konva.Node) => {
                    if(element.attrs.id_unique === arrow.getAttr("anchorIdA")){
                        anchorA = element
                    }

                    if(element.attrs.id_unique === arrow.getAttr("anchorIdB")){
                        anchorB = element
                    }

                    if(element instanceof Konva.Group){
                        element.getChildren().forEach((child: Konva.Node) => {
                            if(child.attrs.id_unique === arrow.getAttr("anchorIdA")){
                                anchorA = child
                            }

                            if(child.attrs.id_unique === arrow.getAttr("anchorIdB")){
                                anchorB = child
                            }
                        })
                    }
                });

                if(anchorA && anchorB){
                    arrow.setAttr("anchorA", anchorA)
                    arrow.setAttr("anchorB", anchorB)

                    this.attachTo(anchorA)
                    this.attachTo(anchorB)

                    this.detach()
                }else{
                    console.log("not found anchors")
                }
            })
        });
    }

    public destroy() {
        this.detach();
    }

}