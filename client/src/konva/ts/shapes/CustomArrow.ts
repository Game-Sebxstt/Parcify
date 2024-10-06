import Konva from 'konva';
import * as konva from '../../js/KonvaLogic.js'

interface ConfigArrow extends Konva.ArrowConfig {
    circleColor?: string;
    circleRadius?: number;
    separationOffset?: number;
}

export class CustomArrow extends Konva.Arrow {
    private circle: Konva.Circle;
    private start: { x: number, y: number };
    private end: { x: number, y: number };
    private customScale: number = 1;
    private separationOffset: number;
    private stage: Konva.Stage;
    private layer: Konva.Layer;

    constructor(config: ConfigArrow) {
        super(config);

        this.stage = konva.stage as Konva.Stage;
        this.layer = konva.layer as Konva.Layer;
        this.separationOffset = config.separationOffset || 10;
        this.start = { x: config.points[0], y: config.points[1] };
        this.end = { x: config.points[2], y: config.points[3] };

        this.circle = new Konva.Circle({
            x: (this.start.x + this.end.x) / 2,
            y: (this.start.y + this.end.y) / 2,
            radius: config.circleRadius || 7 * this.stage.scaleX(),
            fill: config.circleColor || 'white',
            stroke: config.stroke,
            strokeWidth: config.strokeWidth * this.stage.scaleX(),
            draggable: true,
        });

        this.circle.hide();

        this.circle.on('dragmove', () => {
            this.updateArrow();
            this.layer.batchDraw();
        });

        this.stage.on("wheel", () => {
            this.updateArrow();
            this.layer.batchDraw();
        });

        this.layer.add(this);
        this.layer.add(this.circle);

        this.updateArrow();
    }

    private updateScale() {
        this.customScale = this.stage.scaleX() > 0.3 ? this.stage.scaleX() : 0.3;
        this.customScale = this.customScale < 5 ? this.customScale : 5;
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

    public updateArrow() {
        const anchorA = this.getAttr("anchorA");
        const anchorTypeA = this.getAttr("anchorTypeA");
        const anchorB = this.getAttr("anchorB");
        const anchorTypeB = this.getAttr("anchorTypeB");
        
        if (!anchorA || !anchorB) return;

        const startPos = this.calculateArrowPosition(anchorA, anchorTypeA);
        const endPos = this.calculateArrowPosition(anchorB, anchorTypeB);
        const middlePos = this.calculateMiddlePosition(startPos, endPos, anchorTypeA);

        this.points([startPos.x, startPos.y, middlePos.x, middlePos.y, endPos.x, endPos.y]);
        this.setAttrs({
            pointerLength: 10 / this.customScale,
            pointerWidth: 10 / this.customScale,
            strokeWidth: 2 / this.customScale,
        });
    }

    public initAnchors() {
        this.circle.show();
    }

    public loadAnchors(elements: Konva.Node[]) {
        console.log(elements)
        const anchorA = elements.find(element => element.attrs.id_unique == this.getAttr("anchorIdA"))
        const anchorB = elements.find(element => element.attrs.id_unique == this.getAttr("anchorIdB"))

        console.log(anchorA, anchorB)

        this.setAttrs({
            anchorA: anchorA,
            anchorB: anchorB,
        })
    }

    public destroyAnchors() {
        this.circle.destroy();
    }

    public destroyArrow() {
        this.destroyAnchors();
        this.destroy();
    }
}