import React, { useEffect, useRef, useState } from 'react';
import PickCustom from './PickCustom.jsx';
import { actionToolBar, adjustDropdownPositions } from '../../../../konva/js/GlobalFunctions.js';
import { Bold, Italic, Underline, AlignCenter, AlignLeft, AlignRight, AlignJustify, List, Trash2, MoreVertical, ChevronDown, Link, FileCode, Square, Type, Minus, X } from 'lucide-react';
import { setDimensionDropdown } from '../../../../konva/js/KonvaLogic.js';
import { generateID } from '../../../../js/frontend/utilities/globals.js';

const IconButton = ({ Icon, color = "rgba(255,255,255,.8)", hoverClass = "hover:bg-[#3a3a3a]", isActive = false, onClick }) => (
  <button 
    className={`p-2 rounded-md ${hoverClass} ${isActive ? 'bg-[#3a3a3a]' : ''}`} 
    onClick={onClick}
  >
    <Icon size={20} color={isActive ? "#3b82f6" : color} />
  </button>
);

const ButtonGroup = ({ children, border = false }) => (
  <span className={`flex items-center gap-x-1 ${border ? 'border-r border-[rgba(255,255,255,.2)] pr-2 mr-2' : ''}`}>
    {children}
  </span>
);

const DropdownCol = ({ isOpen, onClose, children, width = 'w-40' }) => {
  const dropdownRef = useRef(null);

  useEffect(() => {
    if(isOpen && dropdownRef.current){
      const rect = dropdownRef.current.getBoundingClientRect();
      const dimensionRect = {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        element:  dropdownRef.current,
      }
      setDimensionDropdown(dimensionRect);
    }

    adjustDropdownPositions(document.querySelector("#BarTool").getBoundingClientRect(), document.querySelector("#header-konva").getBoundingClientRect().height)

  },[isOpen])

  if (!isOpen) return null;
  
  return (
    <div 
      ref={dropdownRef}
      data-id-dropdown={generateID()}
      className={`dropdown-tool-bar absolute flex flex-col -top-1/2 -translate-y-full left-0 bg-[#2e2e2e] border-[1px] border-[rgba(255,255,255,.2)] rounded-md shadow-lg p-1 max-h-60 overflow-y-auto ${width}`}>
      {children}
    </div>
  );
};

const DropdownRow = ({ isOpen, onClose, children }) => {
  const dropdownRef = useRef(null);

  useEffect(() => {
    if(isOpen && dropdownRef.current){
      const rect = dropdownRef.current.getBoundingClientRect();
      const dimensionRect = {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        element:  dropdownRef.current,
      }
      setDimensionDropdown(dimensionRect);
    }

    adjustDropdownPositions(document.querySelector("#BarTool").getBoundingClientRect(), document.querySelector("#header-konva").getBoundingClientRect().height)

  },[isOpen])

  if (!isOpen) return null;
  
  return (
    <div 
      ref={dropdownRef}
      className="dropdown-tool-bar absolute flex flex-row -top-1/2 -translate-y-full left-0 bg-[#2e2e2e] border-[1px] border-[rgba(255,255,255,.2)] rounded-md shadow-lg p-1 max-h-60 overflow-y-auto">
      {children}
    </div>
  );
};

const FontSizeButton = ({ size, activeSize, onClick }) => (
  <button
    className={`w-full text-left p-2 text-sm text-white hover:bg-[#3a3a3a] ${activeSize === size ? 'bg-[#3a3a3a]' : ''}`}
    onClick={() => onClick(size)}
  >
    {size}px
  </button>
);

const FontFamilyButton = ({ font, activeFont, onClick }) => (
  <button
    className={`w-full text-left p-2 text-sm text-white hover:bg-[#3a3a3a] ${activeFont === font ? 'bg-[#3a3a3a]' : ''}`}
    onClick={() => onClick(font)}
    style={{ fontFamily: font }}
  >
    {font}
  </button>
);

const StrokeTypeButton = ({ type, activeType, onClick }) => {
  const getIcon = () => {
    switch (type) {
      case 'normal':
        return <Minus size={20} />;
      case 'dash':
        return <Minus size={20} strokeDasharray="5,5" />;
      case 'none':
        return <X size={20} />;
      default:
        return null;
    }
  };

  return (
    <button
      className={`w-fit flex items-center justify-between p-2 text-sm text-white hover:bg-[#3a3a3a] ${activeType === type ? 'bg-[#3a3a3a]' : ''}`}
      onClick={() => onClick(type)}
    >
      {getIcon()}
    </button>
  );
};

export const Toolbar = () => {
  const toolbarRef = useRef(null);
  const [dropdownStates, setDropdownStates] = useState({
    align: false,
    list: false,
    color: false,
    fontSize: false,
    fontFamily: false,
    textColor: false,
    stroke: false,
  });
  const [customFontSize, setCustomFontSize] = useState('');
  const [activeStyles, setActiveStyles] = useState({
    fontStyle: null,
    textDecoration: null,
    align: null,
    fill: null,
    fontSize: null,
    fontFamily: null,
    textColor: null,
    stroke: null,
  });
  const [elementTypes, setElementTypes] = useState([]);

  useEffect(() => {
    const handleWheel = (e) => {
      if (toolbarRef.current) {
        toolbarRef.current.style.pointerEvents = "none";
        clearTimeout(window.wheelTimeout);
        window.wheelTimeout = setTimeout(() => {
          if (toolbarRef.current) {
            toolbarRef.current.style.pointerEvents = "auto";
          }
        }, 150);
      }
    };

    const toolbar = toolbarRef.current;
    if (toolbar) {
      toolbar.addEventListener("wheel", handleWheel);
    }

    return () => {
      if (toolbar) {
        toolbar.removeEventListener("wheel", handleWheel);
 }
    };
  }, []);

  useEffect(() => {
    const handleUpdateToolBar = (event) => {
      const data = event.detail;
      
      if (data && data.attrs) {
        const attrsNode = data.attrs;

        setActiveStyles({
          fontStyle: attrsNode.fontStyle || null,
          textDecoration: attrsNode.textDecoration || null,
          align: attrsNode.align || null,
          fill: attrsNode.fill || null,
          fontSize: attrsNode.fontSize || null,
          fontFamily: attrsNode.fontFamily || null,
        });

        setElementTypes(attrsNode.type || []);
      }
    };

    document.addEventListener("updateToolBar", handleUpdateToolBar);

    return () => {
      document.removeEventListener("updateToolBar", handleUpdateToolBar);
    };
  }, []);

  const toggleDropdown = (dropdownName) => {
    setDropdownStates(prevStates => {
      const allClosed = Object.keys(prevStates).reduce((acc, key) => {
        acc[key] = false;
        return acc;
      }, {});

      return {
        ...allClosed,
        [dropdownName]: !prevStates[dropdownName]
      };
    });
  };

  const handleStyleChange = (style) => {
    const newFontStyle = activeStyles.fontStyle === style ? null : style;
    actionToolBar(newFontStyle, 'fontStyle', true);
    setActiveStyles(prev => ({ ...prev, fontStyle: newFontStyle }));
  };

  const handleTextDecorationChange = (decoration) => {
    const newTextDecoration = activeStyles.textDecoration === decoration ? null : decoration;
    actionToolBar(newTextDecoration, 'textDecoration', true);
    setActiveStyles(prev => ({ ...prev, textDecoration: newTextDecoration }));
  };

  const handleAlign = (alignment) => {
    actionToolBar(alignment, 'align');
    setActiveStyles(prev => ({ ...prev, align: alignment }));
  };

  const handleColorChange = (color) => {
    actionToolBar(color, 'fill');
    setActiveStyles(prev => ({ ...prev, fill: color }));
  };

  const handleTextColorChange = (color) => {
    actionToolBar(color, 'textColor');
    setActiveStyles(prev => ({ ...prev, textColor: color }));
  };

  const handleFontSizeChange = (size) => {
    actionToolBar(size, 'fontSize');
    setActiveStyles(prev => ({ ...prev, fontSize: size }));
    setCustomFontSize('');
  };

  const handleCustomFontSizeChange = (e) => {
    setCustomFontSize(e.target.value);
  };

  const handleCustomFontSizeSubmit = (e) => {
    e.preventDefault();
    const size = parseInt(customFontSize, 10);
    if (!isNaN(size) && size > 0) {
      handleFontSizeChange(size);
    }
  };

  const handleFontFamilyChange = (family) => {
    actionToolBar(family, 'fontFamily');
    setActiveStyles(prev => ({ ...prev, fontFamily: family }));
  };

  const handleStrokeTypeChange = (type) => {
    actionToolBar(type, 'border');
    setActiveStyles(prev => ({ ...prev, strokeType: type }));
  };

  const hasText = elementTypes.includes('Text');
  const hasShape = elementTypes.some(type => ['Rect', 'Circle', 'Ellipse', 'Line', 'Arrow', 'Star', 'Ring'].includes(type));

  return (
    <div ref={toolbarRef} id='BarTool' className="bg-[#2e2e2e] border-[1px] border-[rgba(255,255,255,.2)] rounded-lg shadow-lg hidden items-center p-1 gap-x-1 absolute top-28 left-28">
      {(hasText || hasShape) && (
        <ButtonGroup border>
          <div className="relative">
            <button className="flex items-center gap-x-1 p-2 rounded-md hover:bg-[#3a3a3a]" onClick={() => toggleDropdown('color')}>
              <Square size={20} color={activeStyles.fill} fill={activeStyles.fill}/>
              <ChevronDown size={16} color="rgba(255,255,255,.8)"/>
            </button>
            <DropdownRow isOpen={dropdownStates.color}>
            <PickCustom onColorChange={handleColorChange} colorProperty="fill" />
            </DropdownRow>
          </div>
        </ButtonGroup>
      )}

      {hasText && (
        <>
          <ButtonGroup border>
            <div className="relative">
              <button className="flex items-center gap-x-1 p-2 rounded-md hover:bg-[#3a3a3a]" onClick={() => toggleDropdown('textColor')}>
                <Type size={20} color={activeStyles.textColor || "rgba(255,255,255,.8)"} />
                <ChevronDown size={16} color="rgba(255,255,255,.8)"/>
              </button>
              <DropdownRow isOpen={dropdownStates.textColor}>
              <PickCustom onColorChange={handleTextColorChange} colorProperty="textColor" />
              </DropdownRow>
            </div>
          </ButtonGroup>

          <ButtonGroup border>
            <div className="relative">
              <button className="flex items-center gap-x-1 p-2 rounded-md hover:bg-[#3a3a3a]" onClick={() => toggleDropdown('fontSize')}>
                <Type size={20} color="rgba(255,255,255,.8)" />
                <span className="text-sm text-white">{activeStyles.fontSize}</span>
                <ChevronDown size={16} color="rgba(255,255,255,.8)" />
              </button>
              <DropdownCol isOpen={dropdownStates.fontSize} width="w-48">
                {[12, 16, 24, 36].map(size => (
                  <FontSizeButton key={size} size={size} activeSize={activeStyles.fontSize} onClick={handleFontSizeChange} />
                ))}
                <form onSubmit={handleCustomFontSizeSubmit} className="flex items-center p-2">
                  <input
                    type="number"
                    value={customFontSize}
                    onChange={handleCustomFontSizeChange}
                    placeholder="Custom size"
                    className="w-full p -1 text-sm text-white bg-[#3a3a3a] rounded"
                  />
                  <button type="submit" className="ml-2 p-1 bg-blue-500 text-white rounded">Set</button>
                </form>
              </DropdownCol>
            </div>
            <div className="relative">
              <button className="flex items-center gap-x-1 p-2 rounded-md hover:bg-[#3a3a3a]" onClick={() => toggleDropdown('fontFamily')}>
                <span className="text-sm text-white truncate w-24" style={{ fontFamily: activeStyles.fontFamily }}>{activeStyles.fontFamily}</span>
                <ChevronDown size={16} color="rgba(255,255,255,.8)" />
              </button>
              <DropdownCol isOpen={dropdownStates.fontFamily} width="w-48">
                {['Arial', 'Helvetica', 'Times New Roman', 'Courier', 'Verdana', 'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS', 'Trebuchet MS', 'Arial Black', 'Impact'].map(font => (
                  <FontFamilyButton key={font} font={font} activeFont={activeStyles.fontFamily} onClick={handleFontFamilyChange} />
                ))}
              </DropdownCol>
            </div>
          </ButtonGroup>

          <ButtonGroup border>
            <IconButton Icon={Bold} onClick={() => handleStyleChange('bold')} isActive={activeStyles.fontStyle === 'bold'} />
            <IconButton Icon={Italic} onClick={() => handleStyleChange('italic')} isActive={activeStyles.fontStyle === 'italic'} />
            <IconButton Icon={Underline} onClick={() => handleTextDecorationChange('underline')} isActive={activeStyles.textDecoration === 'underline'} />
            <IconButton 
              Icon={({ size, color }) => (
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M16 6.5a4 2 0 0 0-4-1.5h-1a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-1.5a4 2 0 0 1-4-1.5" />
                </svg>
              )}
              onClick={() => handleTextDecorationChange('line-through')}
              isActive={activeStyles.textDecoration === 'line-through'}
            />
          </ButtonGroup>

          <ButtonGroup border>
            <div className="relative">
              <button className="flex items-center gap-x-1 p-2 rounded-md hover:bg-[#3a3a3a]" onClick={() => toggleDropdown('align')}>
                <AlignCenter size={20} color="rgba(255,255,255,.8)" />
                <ChevronDown size={16} color="rgba(255,255,255,.8)" />
              </button>
              <DropdownRow isOpen={dropdownStates.align}>
                <IconButton Icon={AlignLeft} onClick={() => handleAlign('left')} isActive={activeStyles.align === 'left'} />
                <IconButton Icon={AlignCenter} onClick={() => handleAlign('center')} isActive={activeStyles.align === 'center'} />
                <IconButton Icon={AlignRight} onClick={() => handleAlign('right')} isActive={activeStyles.align === 'right'} />
                <IconButton Icon={AlignJustify} onClick={() => handleAlign('justify')} isActive={activeStyles.align === 'justify'} />
              </DropdownRow>
            </div>
          </ButtonGroup>
        </>
      )}

      <ButtonGroup border>
          <div className="relative">
            <button className="flex items-center gap-x-1 p-2 rounded-md hover:bg-[#3a3a3a]" onClick={() => toggleDropdown('strokeType')}>
              <Minus size={20} color="rgba(255,255,255,.8)" strokeDasharray={activeStyles.strokeType === 'dashed' ? "5,5" : "0"} />
              <ChevronDown size={16} color="rgba(255,255,255,.8)"/>
            </button>
            <DropdownRow isOpen={dropdownStates.strokeType} width="w-fit">
              <StrokeTypeButton type="normal" activeType={activeStyles.strokeType} onClick={handleStrokeTypeChange} />
              <StrokeTypeButton type="dash" activeType={activeStyles.strokeType} onClick={handleStrokeTypeChange} />
              <StrokeTypeButton type="none" activeType={activeStyles.strokeType} onClick={handleStrokeTypeChange} />
            </DropdownRow>
          </div>
      </ButtonGroup>

      <ButtonGroup>
        <IconButton Icon={Link} />
        <IconButton Icon={FileCode} />
      </ButtonGroup>

      <div className="flex-grow"></div>

      <ButtonGroup>
        <IconButton Icon={Trash2} color="#f87171" />
        <IconButton Icon={MoreVertical} />
      </ButtonGroup>
    </div>
  );
};