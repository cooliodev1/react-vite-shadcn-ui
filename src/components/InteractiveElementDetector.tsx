import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scissors, Target, Scan } from 'lucide-react';

interface DetectedElement {
  id: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  elementType: 'logo' | 'text' | 'button' | 'graphic' | 'shape' | 'unknown';
  confidence: number;
  averageColor: string;
  isHighContrast: boolean;
}

interface DetectedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  elementType: 'logo' | 'text' | 'button' | 'graphic' | 'shape' | 'unknown';
}

interface CroppedResult {
  id: string;
  region: DetectedRegion;
  imageData: string; // base64 data URL
  selectedColors: Set<string>;
  timestamp: number;
}

interface InteractiveElementDetectorProps {
  imageSrc: string | null;
  onCropRegion?: (region: DetectedRegion) => void;
  onShowPreview?: (imageData: string, element: DetectedElement) => void;
  selectedColors?: Set<string>;
  isVisible?: boolean;
}

const InteractiveElementDetector: React.FC<InteractiveElementDetectorProps> = ({
  imageSrc,
  onCropRegion,
  onShowPreview,
  selectedColors = new Set(),
  isVisible = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAnalysisMode, setIsAnalysisMode] = useState(false);
  const [hoveredElement, setHoveredElement] = useState<DetectedElement | null>(null);
  const [selectedElement, setSelectedElement] = useState<DetectedElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [sensitivity, setSensitivity] = useState(50); // 0-100 scale

  // Load and draw image
  const loadImage = async () => {
    if (!imageSrc || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageSrc;
    });

    // Set canvas size to match image
    const maxWidth = 800;
    const maxHeight = 600;
    let { width, height } = img;
    
    if (width > maxWidth || height > maxHeight) {
      const scale = Math.min(maxWidth / width, maxHeight / height);
      width *= scale;
      height *= scale;
    }
    
    canvas.width = width;
    canvas.height = height;
    setCanvasSize({ width, height });
    
    ctx.drawImage(img, 0, 0, width, height);
    
    // Store image data for analysis
    const imgData = ctx.getImageData(0, 0, width, height);
    setImageData(imgData);
  };

  // Analyze area around mouse position for graphical elements
  const analyzeAreaAroundPoint = useCallback((x: number, y: number): DetectedElement | null => {
    if (!imageData || !canvasSize.width || !canvasSize.height) return null;

    const { data, width, height } = imageData;
    const searchRadius = Math.max(5, (100 - sensitivity) / 2); // Smaller radius for higher sensitivity
    
    // Get pixel at mouse position
    const centerIndex = (Math.floor(y) * width + Math.floor(x)) * 4;
    if (centerIndex < 0 || centerIndex >= data.length) return null;
    
    const centerR = data[centerIndex];
    const centerG = data[centerIndex + 1];
    const centerB = data[centerIndex + 2];
    const centerA = data[centerIndex + 3];
    
    // Skip transparent areas
    if (centerA < 50) return null;
    
    // Find the boundaries of the connected component
    const visited = new Set<string>();
    const queue: Array<{x: number, y: number}> = [{x: Math.floor(x), y: Math.floor(y)}];
    let minX = Math.floor(x), maxX = Math.floor(x);
    let minY = Math.floor(y), maxY = Math.floor(y);
    let pixelCount = 0;
    let totalR = 0, totalG = 0, totalB = 0;
    let contrastSum = 0;
    
    const colorThreshold = Math.max(10, (100 - sensitivity) * 0.5); // More sensitive color matching
    const maxPixels = 10000; // Prevent infinite loops
    
    while (queue.length > 0 && pixelCount < maxPixels) {
      const current = queue.shift();
      if (!current) break;
      
      const key = `${current.x},${current.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      
      const index = (current.y * width + current.x) * 4;
      if (index < 0 || index >= data.length) continue;
      
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      
      // Check if pixel is similar to center pixel
      const colorDiff = Math.abs(r - centerR) + Math.abs(g - centerG) + Math.abs(b - centerB);
      if (colorDiff > colorThreshold || a < 50) continue;
      
      // Update boundaries
      minX = Math.min(minX, current.x);
      maxX = Math.max(maxX, current.x);
      minY = Math.min(minY, current.y);
      maxY = Math.max(maxY, current.y);
      
      // Accumulate color data
      totalR += r;
      totalG += g;
      totalB += b;
      pixelCount++;
      
      // Calculate local contrast
      let localContrast = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIndex = (ny * width + nx) * 4;
            const nr = data[nIndex];
            const ng = data[nIndex + 1];
            const nb = data[nIndex + 2];
            localContrast += Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb);
          }
        }
      }
      contrastSum += localContrast;
      
      // Add neighboring pixels to queue
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nKey = `${nx},${ny}`;
            if (!visited.has(nKey) && Math.abs(nx - x) <= searchRadius && Math.abs(ny - y) <= searchRadius) {
              queue.push({x: nx, y: ny});
            }
          }
        }
      }
    }
    
    // Check if we found a significant element
    const elementWidth = maxX - minX + 1;
    const elementHeight = maxY - minY + 1;
    const area = elementWidth * elementHeight;
    const minSize = Math.max(5, (100 - sensitivity) / 5); // Smaller minimum for higher sensitivity
    
    if (pixelCount < minSize || area < minSize * minSize) return null;
    
    // Calculate average color and contrast
    const avgR = Math.round(totalR / pixelCount);
    const avgG = Math.round(totalG / pixelCount);
    const avgB = Math.round(totalB / pixelCount);
    const avgContrast = contrastSum / pixelCount;
    
    // Classify element type based on characteristics
    const elementType = classifyElement(elementWidth, elementHeight, area, avgContrast, pixelCount);
    
    // Calculate confidence based on contrast, size, and regularity
    const sizeScore = Math.min(1, area / 1000);
    const contrastScore = Math.min(1, avgContrast / 100);
    const shapeScore = Math.min(elementWidth, elementHeight) / Math.max(elementWidth, elementHeight);
    const confidence = (sizeScore * 0.4 + contrastScore * 0.4 + shapeScore * 0.2) * 100;
    
    return {
      id: `element-${minX}-${minY}-${Date.now()}`,
      boundingBox: {
        x: minX,
        y: minY,
        width: elementWidth,
        height: elementHeight
      },
      elementType,
      confidence: Math.round(confidence),
      averageColor: `rgb(${avgR}, ${avgG}, ${avgB})`,
      isHighContrast: avgContrast > 50
    };
  }, [imageData, canvasSize, sensitivity]);

  // Classify element type based on characteristics
  const classifyElement = (width: number, height: number, area: number, contrast: number, pixelCount: number): DetectedElement['elementType'] => {
    const aspectRatio = width / height;
    const density = pixelCount / area;
    
    // Logo detection: medium size, high contrast, roughly square or rectangular
    if (area > 100 && area < 5000 && contrast > 40 && density > 0.3) {
      if (aspectRatio > 0.5 && aspectRatio < 2.0) {
        return 'logo';
      }
    }
    
    // Button detection: rectangular, medium size, moderate contrast
    if (aspectRatio > 1.5 && aspectRatio < 4.0 && area > 200 && area < 3000 && contrast > 25) {
      return 'button';
    }
    
    // Text detection: very rectangular, smaller height
    if (aspectRatio > 3.0 && height < 50 && contrast > 30) {
      return 'text';
    }
    
    // Graphic/icon detection: small to medium, high contrast
    if (area > 50 && area < 2000 && contrast > 50) {
      return 'graphic';
    }
    
    // Shape detection: regular shape, good density
    if (density > 0.7 && contrast > 20) {
      return 'shape';
    }
    
    return 'unknown';
  };

  // Handle mouse move over canvas
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isAnalysisMode) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const element = analyzeAreaAroundPoint(x, y);
    setHoveredElement(element);
  }, [isAnalysisMode, analyzeAreaAroundPoint]);

  // Handle click to select element
  const handleCanvasClick = useCallback(() => {
    if (!isAnalysisMode || !hoveredElement) return;
    
    setSelectedElement(hoveredElement);
    // Create a cropped result
    createCroppedResult(hoveredElement);
  }, [isAnalysisMode, hoveredElement]);

  // Handle crop element and create result
  const handleCropElement = (element: DetectedElement) => {
    const region: DetectedRegion = {
      ...element.boundingBox,
      confidence: element.confidence,
      elementType: element.elementType
    };
    onCropRegion?.(region);
    createCroppedResult(element);
  };

  // Create cropped result with color processing
  const createCroppedResult = async (element: DetectedElement) => {
    if (!canvasRef.current || !onShowPreview) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a new canvas for the cropped region
    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return;

    const { x, y, width, height } = element.boundingBox;
    cropCanvas.width = width;
    cropCanvas.height = height;

    // Draw the cropped region
    cropCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);

    // Convert to data URL
    const croppedImageData = cropCanvas.toDataURL();

    // Create the element object for the callback
    const detectedElement: DetectedElement = {
      id: `detected_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      boundingBox: element.boundingBox,
      elementType: element.elementType,
      confidence: element.confidence,
      averageColor: element.averageColor,
      isHighContrast: element.isHighContrast
    };

    onShowPreview(croppedImageData, detectedElement);
  };

  // Load image when source changes
  useEffect(() => {
    if (imageSrc && isVisible) {
      loadImage();
    }
  }, [imageSrc, isVisible]);

  if (!isVisible || !imageSrc) return null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4" />
          <span className="font-medium">Interactive Element Detection</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsAnalysisMode(!isAnalysisMode)}
            variant={isAnalysisMode ? "default" : "outline"}
            size="sm"
            className="flex items-center gap-1"
          >
            <Scan className="w-3 h-3" />
            {isAnalysisMode ? 'Exit Analysis' : 'Start Analysis'}
          </Button>
        </div>
      </div>

      {/* Sensitivity Control */}
      {isAnalysisMode && (
        <div className="flex items-center gap-2">
          <span className="text-sm">Sensitivity:</span>
          <input
            type="range"
            min="1"
            max="100"
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-sm w-8">{sensitivity}%</span>
        </div>
      )}

      {/* Instructions */}
      {isAnalysisMode && (
        <div className="text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
          <strong>Hover Analysis Mode:</strong> Move your mouse over the image to detect graphical elements in real-time. 
          Click on highlighted areas to select them for cropping.
        </div>
      )}

      {/* Canvas with overlays */}
      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onClick={handleCanvasClick}
          className={`border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm ${
            isAnalysisMode ? 'cursor-crosshair' : 'cursor-default'
          }`}
          style={{ display: 'block' }}
        />
        
        {/* Hover overlay */}
        {isAnalysisMode && hoveredElement && (
          <div
            className="absolute border-2 border-yellow-400 bg-yellow-400/20 pointer-events-none transition-all duration-100"
            style={{
              left: `${hoveredElement.boundingBox.x}px`,
              top: `${hoveredElement.boundingBox.y}px`,
              width: `${hoveredElement.boundingBox.width}px`,
              height: `${hoveredElement.boundingBox.height}px`,
            }}
          >
            {/* Element info */}
            <div className="absolute -top-8 left-0 flex items-center gap-1">
              <Badge variant="secondary" className="text-xs bg-yellow-500 text-white">
                {hoveredElement.elementType} ({hoveredElement.confidence}%)
              </Badge>
            </div>
          </div>
        )}

        {/* Selected element overlay */}
        {selectedElement && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none"
            style={{
              left: `${selectedElement.boundingBox.x}px`,
              top: `${selectedElement.boundingBox.y}px`,
              width: `${selectedElement.boundingBox.width}px`,
              height: `${selectedElement.boundingBox.height}px`,
            }}
          >
            {/* Selected element info */}
            <div className="absolute -top-8 left-0 flex items-center gap-1">
              <Badge variant="secondary" className="text-xs bg-blue-500 text-white">
                Selected: {selectedElement.elementType}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-5 w-5 p-0 bg-white/90 hover:bg-white"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCropElement(selectedElement);
                }}
              >
                <Scissors className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Selected element info */}
      {selectedElement && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-blue-900 dark:text-blue-100">
                Selected: {selectedElement.elementType.charAt(0).toUpperCase() + selectedElement.elementType.slice(1)}
              </h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Size: {selectedElement.boundingBox.width} × {selectedElement.boundingBox.height} | 
                Confidence: {selectedElement.confidence}% | 
                {selectedElement.isHighContrast ? 'High' : 'Low'} contrast
              </p>
            </div>
            <Button
              onClick={() => handleCropElement(selectedElement)}
              size="sm"
              className="flex items-center gap-1"
            >
              <Scissors className="w-3 h-3" />
              Crop Element
            </Button>
          </div>
        </div>
      )}

      {/* Analysis stats */}
      {isAnalysisMode && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Hover over different areas to detect graphical elements. Sensitivity: {sensitivity}% 
          {hoveredElement && (
            <span className="ml-2 text-yellow-600 dark:text-yellow-400">
              • Detecting {hoveredElement.elementType} at ({hoveredElement.boundingBox.x}, {hoveredElement.boundingBox.y})
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default InteractiveElementDetector;
