import Konva from 'konva';

interface PickerConfig {
    blockWidth: number;
    blockHeight: number;
    stripWidth: number;
}

interface RGBADimension {
    x: number;
    y: number;
    xRelative: number;
    yRelative: number;
    width: number;
    height: number;
    fill?: string;
}

export class PickerCustom {
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private layerUtilities: Konva.Layer;
    private config: PickerConfig;
    private umbralSeparation: number = 10;

    private colorBlock!: Konva.Rect;
    private colorStrip!: Konva.Rect;
    private gradientWhite!: Konva.Rect;
    private gradientBlack!: Konva.Rect;
    private picker!: Konva.Circle;
    private pickerStrip!: Konva.Rect;

    private selectedColor: string = 'rgba(255,255,0,1)';
    private nodeSelect: Konva.NodeConfig | null = null;
    private pos: { x: number, y: number } = { x: 0, y: 0 };
    private drag: boolean = false;
    private dragPicker: boolean = false;

    constructor(stage: Konva.Stage, layer: Konva.Layer, layerUtilities: Konva.Layer, config: PickerConfig) {
        this.stage = stage;
        this.layer = layer;
        this.layerUtilities = layerUtilities;
        this.config = config;

        this.initPickerElements();
        this.initPicker();
    }

    private initPickerElements() {
        this.colorStrip = this.createColorStrip();
        this.colorBlock = this.createColorBlock();
        this.gradientWhite = this.createGradientWhite();
        this.gradientBlack = this.createGradientBlack();
        this.picker = this.createPicker();
        this.pickerStrip = this.createPickerStrip();

        this.layerUtilities.add(this.colorStrip, this.colorBlock, this.gradientWhite, this.gradientBlack);
        this.layer.add(this.picker, this.pickerStrip);
    }

    private createColorStrip(): Konva.Rect {
        return new Konva.Rect({
            width: this.config.stripWidth,
            height: this.config.blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this.config.blockHeight },
            fillLinearGradientColorStops: [
                0, 'rgba(255, 0, 0, 1)',
                0.17, 'rgba(255, 255, 0, 1)',
                0.34, 'rgba(0, 255, 0, 1)',
                0.51, 'rgba(0, 255, 255, 1)',
                0.68, 'rgba(0, 0, 255, 1)',
                0.85, 'rgba(255, 0, 255, 1)',
                1, 'rgba(255, 0, 0, 1)'
            ],
            visible: false,
            pick: true,
        });
    }

    private createColorBlock(): Konva.Rect {
        return new Konva.Rect({
            width: this.config.blockWidth,
            height: this.config.blockHeight,
            fill: 'rgba(255,255,0,1)',
            visible: false,
            block: true,
        });
    }

    private createGradientWhite(): Konva.Rect {
        return new Konva.Rect({
            width: this.config.blockWidth,
            height: this.config.blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.config.blockWidth, y: 0 },
            fillLinearGradientColorStops: [0, 'rgba(255,255,255,1)', 1, 'rgba(255,255,255,0)'],
            visible: false,
            block: true,
        });
    }

    private createGradientBlack(): Konva.Rect {
        return new Konva.Rect({
            width: this.config.blockWidth,
            height: this.config.blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this.config.blockHeight },
            fillLinearGradientColorStops: [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,1)'],
            visible: false,
            block: true,
        });
    }

    private createPicker(): Konva.Circle {
        return new Konva.Circle({
            radius: 5,
            fill: 'red',
            listening: false,
            draggable: false,
        });
    }

    private createPickerStrip(): Konva.Rect {
        return new Konva.Rect({
            width: this.config.stripWidth,
            height: 2,
            fill: 'black',
            listening: false,
            draggable: false,
        });
    }

    private initPicker() {
        this.pos = this.stage.getRelativePointerPosition() || { x: 0, y: 0 };
        this.setElementPositions();
        this.attachEventListeners();
        this.layerUtilities.batchDraw();
    }

    private setElementPositions() {
        this.colorStrip.setAttrs({
            x: this.pos.x + this.config.blockWidth + this.umbralSeparation,
            y: this.pos.y,
        });
        this.colorBlock.setAttrs({ x: this.pos.x, y: this.pos.y });
        this.fillGradient();
    }

    private attachEventListeners() {
        this.colorStrip.on("click", (e) => this.pickHue(e, this.picker));
        this.stage.on("mousedown", this.handleMouseDown.bind(this));
        this.stage.on("mousemove", this.handleMouseMove.bind(this));
        this.stage.on("mouseup", this.handleMouseUp.bind(this));
    }

    private handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
        if(e.target.getAttr("pick")) this.startDrag(e);
        if(e.target.getAttr("block")) this.startPickHue(e);
    }

    private handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
        if(this.drag) {
            this.changeColor(e);
        } else if(this.dragPicker) {
            this.pickHue(e, this.stage);
        }
    }

    private handleMouseUp(e: Konva.KonvaEventObject<MouseEvent>) {
        this.stopDrag();
        this.endPickHue();
    }

    private fillGradient() {
        this.gradientWhite.setAttrs({ x: this.pos.x, y: this.pos.y });
        this.gradientBlack.setAttrs({ x: this.pos.x, y: this.pos.y });
        this.picker.setAttrs({ x: this.config.blockWidth - 1, y: 0 });
        this.pickerStrip.setAttrs({ x: this.colorStrip.x(), y: 0 });
    }

    private startPickHue(e: Konva.KonvaEventObject<MouseEvent>) {
        if(e.target.getAttr("block") == undefined) return;
        this.dragPicker = true;
        this.pickHue(e, this.stage);
    }

    private pickHue(e: Konva.KonvaEventObject<MouseEvent> | undefined, element: Konva.Circle | Konva.Stage) {
        if (!this.dragPicker && element !== this.picker) return;

        let pos = element instanceof Konva.Stage ? element.getPointerPosition() : element.absolutePosition();
        let posRelative = element instanceof Konva.Stage ? element.getRelativePointerPosition() : element.position();

        if (!pos || !posRelative ) return;

        const blockLeft = this.colorBlock.x();
        const blockRight = blockLeft + this.config.blockWidth;
        const blockTop = this.colorBlock.y();
        const blockBottom = blockTop + this.config.blockHeight;

        pos.x = Math.max(blockLeft, Math.min(blockRight, pos.x));
        pos.y = Math.max(blockTop, Math.min(blockBottom, pos.y));

        posRelative.x = pos.x - blockLeft;
        posRelative.y = pos.y - blockTop;

        if(posRelative.x <= 0) {
            pos.x += 1;
        }else if(posRelative.x >= this.colorBlock.width() * this.colorBlock.scaleX()) {
            pos.x -= 1
        }

        const imageData = this.layerUtilities.getContext().getImageData(pos.x, pos.y, 1, 1).data;
        const rgbaColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, 1)`;

        this.picker.setAttrs({ x: posRelative.x, y: posRelative.y });
        
        const rgbaDimension: RGBADimension = {
            x: pos.x,
            y: pos.y,
            xRelative: posRelative.x,
            yRelative: posRelative.y,
            width: 1,
            height: 1,
        };

        this.nodeSelect?.setAttr('blockDimension', rgbaDimension);
        this.selectedColor = rgbaColor;
        this.nodeSelect?.fill(rgbaColor);
        this.layerUtilities.batchDraw();
    }

    private endPickHue() {
        this.dragPicker = false;
    }

    private startDrag(e: Konva.KonvaEventObject<MouseEvent>) {
        this.drag = true;
        this.changeColor(e);
    }

    private stopDrag() {
        this.drag = false;
    }

    private changeColor(e: Konva.KonvaEventObject<MouseEvent>) {
        const pos = this.stage.getPointerPosition();
        if (!pos) return;

        let y = pos.y;
        
        const stripTop = this.colorStrip.y();
        const stripBottom = stripTop + this.colorStrip.height();
        y = Math.max(stripTop, Math.min(stripBottom, y));

        if(y >= this.colorStrip.height() * this.colorStrip.scaleY()) {
            y -= 1;
        }

        const imageData = this.layerUtilities.getContext().getImageData(this.colorStrip.x(), y, 1, 1).data;
        const rgbaColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, 1)`;

        this.pickerStrip.setAttrs({ x: this.colorStrip.x(), y: y });

        const rgbaDimension: RGBADimension = {
            x: this.colorStrip.x(),
            y: y,
            xRelative: this.colorStrip.x(),
            yRelative: y,
            width: this.colorStrip.width(),
            height: 1,
            fill: rgbaColor,
        };

        this.nodeSelect?.setAttr('stripDimension', rgbaDimension);
        this.colorBlock.fill(rgbaColor);
        this.layerUtilities.batchDraw();
        this.pickHue(e, this.picker);
    }

    public changePos(pos: { x: number, y: number }) {
        this.pos = pos;
        this.updateElementPositions();
        this.updatePickerVisibility(true);
        this.updateColorBlock();
        this.layerUtilities.batchDraw();
    }

    public updateOnlyPosition(pos: { x: number, y: number }) {
        this.pos = pos;
        this.updateElementPositions();
        this.layerUtilities.batchDraw();
    }

    private updateElementPositions() {
        this.colorBlock.position(this.pos);
        this.colorStrip.position({ x: this.pos.x + this.config.blockWidth + this.umbralSeparation, y: this.pos.y });
        this.gradientWhite.position(this.pos);
        this.gradientBlack.position(this.pos);

        const blockDimension = this.nodeSelect?.getAttr('blockDimension');
        const stripDimension = this.nodeSelect?.getAttr('stripDimension');

        if (blockDimension && stripDimension) {
            this.picker.position({ x: blockDimension.xRelative, y: blockDimension.yRelative });
            this.pickerStrip.position({ x: stripDimension.xRelative, y: stripDimension.yRelative });
        } else {
            this.picker.position({ x: this.config.blockWidth - 1, y: 0 });
            this.pickerStrip.position({ x: this.colorStrip.x(), y: this.pickerStrip.y() });
        }
    }

    private updatePickerVisibility(visible: boolean) {
        this.colorBlock.visible(visible);
        this.colorStrip.visible(visible);
        this.gradientWhite.visible(visible);
        this.gradientBlack.visible(visible);
        this.picker.visible(visible);
        this.pickerStrip.visible(visible);
    }

    private updateColorBlock() {
        const stripDimension = this.nodeSelect?.getAttr('stripDimension');
        const nodeColor = stripDimension?.fill || 'rgba(255,255,0,1)';
        this.colorBlock.fill(nodeColor);
    }

    public getDimensions(): {width: number, height: number} {
        return {
            width: this.config.blockWidth + this.config.stripWidth + this.umbralSeparation,
            height: this.config.blockHeight
        };
    }

    public updateNodeSelect(node: Konva.NodeConfig) {
        this.nodeSelect = node;
    }
}