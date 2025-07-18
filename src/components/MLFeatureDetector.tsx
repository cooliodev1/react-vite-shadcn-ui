import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Eye, Scissors, RefreshCw } from 'lucide-react';

interface DetectedFeature {
  id: string;
  label: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  center: {
    x: number;
    y: number;
  };
  elementType: 'text' | 'button' | 'icon' | 'logo' | 'image' | 'shape' | 'unknown';
}

interface MLFeatureDetectorProps {
  imageSrc: string | null;
  onFeatureSelect?: (feature: DetectedFeature) => void;
  onCropRegion?: (region: { x: number; y: number; width: number; height: number }) => void;
  isVisible?: boolean;
}

const MLFeatureDetector: React.FC<MLFeatureDetectorProps> = ({
  imageSrc,
  onFeatureSelect,
  onCropRegion,
  isVisible = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [detectedFeatures, setDetectedFeatures] = useState<DetectedFeature[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<DetectedFeature | null>(null);
  const [hoveredFeature, setHoveredFeature] = useState<DetectedFeature | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [detectionMode, setDetectionMode] = useState<'objects' | 'ui-elements' | 'edges'>('ui-elements');
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('high');

  // Advanced boundary detection using space analysis
  const analyzeSpaceAroundObject = (canvas: HTMLCanvasElement, initialBox: any) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return initialBox;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Helper function to check if a pixel is "empty" (background)
    const isEmptyPixel = (x: number, y: number) => {
      if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return true;
      
      const index = (y * canvas.width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const alpha = data[index + 3];
      
      // Consider transparent or near-white pixels as empty
      if (alpha < 50) return true;
      
      // Check for near-white background (common in product images)
      const brightness = (r + g + b) / 3;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      
      return brightness > 240 && saturation < 20;
    };

    // Find content boundaries by scanning outward from the initial detection
    const findContentBoundaries = (startBox: any) => {
      let left = Math.max(0, startBox.x);
      let right = Math.min(canvas.width - 1, startBox.x + startBox.width);
      let top = Math.max(0, startBox.y);
      let bottom = Math.min(canvas.height - 1, startBox.y + startBox.height);

      const scanDistance = 50; // Maximum pixels to scan outward
      const minSeparation = 5; // Minimum empty space to consider as separation

      // Expand left boundary
      for (let expansion = 0; expansion < scanDistance; expansion++) {
        let x = left - expansion;
        if (x < 0) break;
        
        let emptyCount = 0;
        for (let y = top; y <= bottom; y++) {
          if (isEmptyPixel(x, y)) emptyCount++;
        }
        
        // If this column is mostly empty, we might have found separation
        if (emptyCount > (bottom - top) * 0.8) {
          // Look for content beyond this empty space
          let hasContent = false;
          for (let lookAhead = 1; lookAhead <= minSeparation && x - lookAhead >= 0; lookAhead++) {
            for (let y = top; y <= bottom; y++) {
              if (!isEmptyPixel(x - lookAhead, y)) {
                hasContent = true;
                break;
              }
            }
            if (hasContent) break;
          }
          if (!hasContent) break; // No content beyond, stop here
        } else {
          left = x; // Found content, expand boundary
        }
      }

      // Expand right boundary
      for (let expansion = 0; expansion < scanDistance; expansion++) {
        let x = right + expansion;
        if (x >= canvas.width) break;
        
        let emptyCount = 0;
        for (let y = top; y <= bottom; y++) {
          if (isEmptyPixel(x, y)) emptyCount++;
        }
        
        if (emptyCount > (bottom - top) * 0.8) {
          let hasContent = false;
          for (let lookAhead = 1; lookAhead <= minSeparation && x + lookAhead < canvas.width; lookAhead++) {
            for (let y = top; y <= bottom; y++) {
              if (!isEmptyPixel(x + lookAhead, y)) {
                hasContent = true;
                break;
              }
            }
            if (hasContent) break;
          }
          if (!hasContent) break;
        } else {
          right = x;
        }
      }

      // Expand top boundary
      for (let expansion = 0; expansion < scanDistance; expansion++) {
        let y = top - expansion;
        if (y < 0) break;
        
        let emptyCount = 0;
        for (let x = left; x <= right; x++) {
          if (isEmptyPixel(x, y)) emptyCount++;
        }
        
        if (emptyCount > (right - left) * 0.8) {
          let hasContent = false;
          for (let lookAhead = 1; lookAhead <= minSeparation && y - lookAhead >= 0; lookAhead++) {
            for (let x = left; x <= right; x++) {
              if (!isEmptyPixel(x, y - lookAhead)) {
                hasContent = true;
                break;
              }
            }
            if (hasContent) break;
          }
          if (!hasContent) break;
        } else {
          top = y;
        }
      }

      // Expand bottom boundary
      for (let expansion = 0; expansion < scanDistance; expansion++) {
        let y = bottom + expansion;
        if (y >= canvas.height) break;
        
        let emptyCount = 0;
        for (let x = left; x <= right; x++) {
          if (isEmptyPixel(x, y)) emptyCount++;
        }
        
        if (emptyCount > (right - left) * 0.8) {
          let hasContent = false;
          for (let lookAhead = 1; lookAhead <= minSeparation && y + lookAhead < canvas.height; lookAhead++) {
            for (let x = left; x <= right; x++) {
              if (!isEmptyPixel(x, y + lookAhead)) {
                hasContent = true;
                break;
              }
            }
            if (hasContent) break;
          }
          if (!hasContent) break;
        } else {
          bottom = y;
        }
      }

      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      };
    };

    return findContentBoundaries(initialBox);
  };

  // Load COCO-SSD model for object detection
  const loadModel = async () => {
    try {
      // We'll use TensorFlow.js COCO-SSD model
      const { load } = await import('@tensorflow-models/coco-ssd');
      const tf = await import('@tensorflow/tfjs');
      
      // Initialize TensorFlow.js
      await tf.ready();
      
      // Load the model
      const model = await load();
      setModelLoaded(true);
      return model;
    } catch (error) {
      console.error('Failed to load ML model:', error);
      return null;
    }
  };

  // Classify detected elements into UI/graphical types
  const classifyElementType = (label: string, bbox: number[]): 'text' | 'button' | 'icon' | 'logo' | 'image' | 'shape' | 'unknown' => {
    const width = bbox[2];
    const height = bbox[3];
    const aspectRatio = width / height;
    const area = width * height;
    
    // Classification based on object type and dimensions
    if (label === 'person' && area < 50000) return 'icon'; // Small person icons
    if (label === 'book' || label === 'laptop' || label === 'cell phone') return 'image';
    if (aspectRatio > 3 && height < 40) return 'text'; // Likely text blocks
    if (aspectRatio > 2 && height < 60) return 'button'; // Button-like shapes
    if (aspectRatio < 1.5 && aspectRatio > 0.7 && area < 10000) return 'icon'; // Square-ish small items
    if (area < 5000) return 'icon'; // Small elements are likely icons
    if (aspectRatio > 4) return 'text'; // Very wide elements are likely text
    
    return 'unknown';
  };

  // Advanced UI element detection using edge detection and contour analysis
  const detectUIElements = async (canvas: HTMLCanvasElement): Promise<DetectedFeature[]> => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    
    // Simple edge detection using Sobel operator
    const edges: number[][] = [];
    for (let y = 0; y < height; y++) {
      edges[y] = [];
      for (let x = 0; x < width; x++) {
        edges[y][x] = 0;
      }
    }

    // Calculate edge strength
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        // Get neighboring pixels
        const topLeft = (data[((y-1) * width + (x-1)) * 4] + data[((y-1) * width + (x-1)) * 4 + 1] + data[((y-1) * width + (x-1)) * 4 + 2]) / 3;
        const top = (data[((y-1) * width + x) * 4] + data[((y-1) * width + x) * 4 + 1] + data[((y-1) * width + x) * 4 + 2]) / 3;
        const topRight = (data[((y-1) * width + (x+1)) * 4] + data[((y-1) * width + (x+1)) * 4 + 1] + data[((y-1) * width + (x+1)) * 4 + 2]) / 3;
        const left = (data[(y * width + (x-1)) * 4] + data[(y * width + (x-1)) * 4 + 1] + data[(y * width + (x-1)) * 4 + 2]) / 3;
        const right = (data[(y * width + (x+1)) * 4] + data[(y * width + (x+1)) * 4 + 1] + data[(y * width + (x+1)) * 4 + 2]) / 3;
        const bottomLeft = (data[((y+1) * width + (x-1)) * 4] + data[((y+1) * width + (x-1)) * 4 + 1] + data[((y+1) * width + (x-1)) * 4 + 2]) / 3;
        const bottom = (data[((y+1) * width + x) * 4] + data[((y+1) * width + x) * 4 + 1] + data[((y+1) * width + x) * 4 + 2]) / 3;
        const bottomRight = (data[((y+1) * width + (x+1)) * 4] + data[((y+1) * width + (x+1)) * 4 + 1] + data[((y+1) * width + (x+1)) * 4 + 2]) / 3;

        // Sobel operators
        const gx = (-1 * topLeft) + (1 * topRight) + (-2 * left) + (2 * right) + (-1 * bottomLeft) + (1 * bottomRight);
        const gy = (-1 * topLeft) + (-2 * top) + (-1 * topRight) + (1 * bottomLeft) + (2 * bottom) + (1 * bottomRight);
        
        edges[y][x] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    // Find rectangular regions with strong edges (potential UI elements)
    const elements: DetectedFeature[] = [];
    const threshold = 50; // Edge strength threshold
    const minSize = 20; // Minimum element size
    const maxSize = Math.min(width, height) * 0.8; // Maximum element size

    // Simplified rectangle detection
    for (let y = 0; y < height - minSize; y += 10) {
      for (let x = 0; x < width - minSize; x += 10) {
        for (let h = minSize; h < maxSize && y + h < height; h += 20) {
          for (let w = minSize; w < maxSize && x + w < width; w += 20) {
            // Check edge strength around rectangle perimeter
            let edgeScore = 0;
            let edgeCount = 0;

            // Top and bottom edges
            for (let i = x; i < x + w && i < width; i++) {
              if (y < height) { edgeScore += edges[y][i]; edgeCount++; }
              if (y + h < height) { edgeScore += edges[y + h][i]; edgeCount++; }
            }
            
            // Left and right edges  
            for (let i = y; i < y + h && i < height; i++) {
              if (x < width) { edgeScore += edges[i][x]; edgeCount++; }
              if (x + w < width) { edgeScore += edges[i][x + w]; edgeCount++; }
            }

            const avgEdgeScore = edgeCount > 0 ? edgeScore / edgeCount : 0;
            
            if (avgEdgeScore > threshold) {
              const elementType = classifyElementType('rectangle', [x, y, w, h]);
              
              // Apply space analysis to refine the UI element boundaries
              const initialBox = { x, y, width: w, height: h };
              const refinedBox = analyzeSpaceAroundObject(canvas, initialBox);
              
              elements.push({
                id: `ui-element-${elements.length}`,
                label: `${elementType} (${refinedBox.width}×${refinedBox.height})`,
                confidence: Math.min(avgEdgeScore / 255, 1),
                boundingBox: refinedBox,
                center: { 
                  x: refinedBox.x + refinedBox.width/2, 
                  y: refinedBox.y + refinedBox.height/2 
                },
                elementType
              });
              
              // Skip overlapping regions
              x += w * 0.8;
              break;
            }
          }
        }
      }
    }

    // Remove overlapping elements and keep the ones with higher confidence
    const filteredElements = elements
      .sort((a, b) => b.confidence - a.confidence)
      .filter((element, index) => {
        return !elements.slice(0, index).some(other => {
          const overlap = !(
            element.boundingBox.x > other.boundingBox.x + other.boundingBox.width ||
            element.boundingBox.x + element.boundingBox.width < other.boundingBox.x ||
            element.boundingBox.y > other.boundingBox.y + other.boundingBox.height ||
            element.boundingBox.y + element.boundingBox.height < other.boundingBox.y
          );
          return overlap;
        });
      })
      .slice(0, 20); // Limit to top 20 elements

    return filteredElements;
  };

  // Detect objects in the image
  const detectFeatures = async () => {
    if (!imageSrc || !canvasRef.current) return;
    
    setIsLoading(true);
    setDetectedFeatures([]);
    
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Load and draw image
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

      // Load model and detect objects
      const model = await loadModel();
      if (!model) {
        throw new Error('Failed to load ML model');
      }

      // Perform detection based on mode
      let features: DetectedFeature[] = [];
      
      if (detectionMode === 'ui-elements') {
        // Use custom UI element detection
        features = await detectUIElements(canvas);
      } else {
        // Use COCO-SSD for general object detection
        const model = await loadModel();
        if (!model) {
          throw new Error('Failed to load ML model');
        }

        const predictions = await model.detect(canvas);
        
        // Convert predictions to our format and apply space analysis
        features = predictions.map((prediction: any, index: number) => {
          const initialBox = {
            x: prediction.bbox[0],
            y: prediction.bbox[1],
            width: prediction.bbox[2],
            height: prediction.bbox[3]
          };

          // Apply space analysis to refine boundaries
          const refinedBox = analyzeSpaceAroundObject(canvas, initialBox);

          return {
            id: `feature-${index}`,
            label: prediction.class,
            confidence: prediction.score,
            boundingBox: refinedBox,
            center: {
              x: refinedBox.x + refinedBox.width / 2,
              y: refinedBox.y + refinedBox.height / 2
            },
            elementType: classifyElementType(prediction.class, prediction.bbox)
          };
        });
      }

      // Filter by confidence threshold - dynamic based on sensitivity
      const confidenceThreshold = sensitivity === 'high' ? 0.1 : sensitivity === 'medium' ? 0.2 : 0.3;
      let filteredFeatures = features.filter(feature => feature.confidence > confidenceThreshold);

      // For high sensitivity, run additional detection passes for smaller elements
      if (sensitivity === 'high' && detectionMode === 'ui-elements') {
        // Second pass: Look for smaller elements within larger detected objects
        const additionalFeatures = await detectSubElements(canvas, filteredFeatures);
        filteredFeatures = [...filteredFeatures, ...additionalFeatures];
        
        // Remove duplicates and overlapping elements
        filteredFeatures = removeDuplicateElements(filteredFeatures);
      }

      setDetectedFeatures(filteredFeatures);

    } catch (error) {
      console.error('Error detecting features:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Detect smaller sub-elements within larger detected objects
  const detectSubElements = async (canvas: HTMLCanvasElement, parentFeatures: DetectedFeature[]): Promise<DetectedFeature[]> => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const subElements: DetectedFeature[] = [];
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Look for high contrast areas that might be logos or text
    for (const parent of parentFeatures) {
      const { x, y, width, height } = parent.boundingBox;
      
      // Only analyze larger elements that might contain sub-elements
      if (width < 50 || height < 50) continue;

      // Analyze contrast and edge density within the parent element
      const subRegions = findHighContrastRegions(data, canvas.width, canvas.height, x, y, width, height);
      
      subRegions.forEach((region, index) => {
        // Only add if it's significantly smaller than the parent
        if (region.width < width * 0.8 && region.height < height * 0.8) {
          subElements.push({
            id: `sub-${parent.id}-${index}`,
            label: `Logo/Text`,
            confidence: region.confidence,
            boundingBox: region,
            center: {
              x: region.x + region.width / 2,
              y: region.y + region.height / 2
            },
            elementType: 'logo'
          });
        }
      });
    }

    return subElements;
  };

  // Find high contrast regions that might contain logos or text
  const findHighContrastRegions = (data: Uint8ClampedArray, canvasWidth: number, canvasHeight: number, 
                                   startX: number, startY: number, regionWidth: number, regionHeight: number) => {
    const regions: Array<{x: number, y: number, width: number, height: number, confidence: number}> = [];
    const minSize = 20; // Minimum size for a logo/text element
    const step = 10; // Step size for scanning

    for (let y = startY; y < startY + regionHeight - minSize; y += step) {
      for (let x = startX; x < startX + regionWidth - minSize; x += step) {
        // Calculate contrast in a small window
        let totalContrast = 0;
        let samples = 0;

        for (let dy = 0; dy < minSize && y + dy < canvasHeight; dy++) {
          for (let dx = 0; dx < minSize && x + dx < canvasWidth; dx++) {
            const i = ((y + dy) * canvasWidth + (x + dx)) * 4;
            if (i + 3 < data.length) {
              const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
              
              // Check contrast with neighbors
              if (dx > 0) {
                const leftI = ((y + dy) * canvasWidth + (x + dx - 1)) * 4;
                const leftBrightness = (data[leftI] + data[leftI + 1] + data[leftI + 2]) / 3;
                totalContrast += Math.abs(brightness - leftBrightness);
                samples++;
              }
            }
          }
        }

        const avgContrast = samples > 0 ? totalContrast / samples : 0;
        
        // If high contrast detected, expand to find the full element
        if (avgContrast > 30) { // Threshold for significant contrast
          const expandedRegion = expandRegion(data, canvasWidth, canvasHeight, x, y, minSize, minSize, 15);
          if (expandedRegion && expandedRegion.width >= minSize && expandedRegion.height >= minSize) {
            // Check if this region overlaps with existing ones
            const overlaps = regions.some(existing => 
              !(expandedRegion.x > existing.x + existing.width || 
                expandedRegion.x + expandedRegion.width < existing.x ||
                expandedRegion.y > existing.y + existing.height || 
                expandedRegion.y + expandedRegion.height < existing.y)
            );
            
            if (!overlaps) {
              regions.push({
                ...expandedRegion,
                confidence: Math.min(avgContrast / 100, 0.9)
              });
            }
          }
        }
      }
    }

    return regions;
  };

  // Expand a region to include connected high-contrast pixels
  const expandRegion = (data: Uint8ClampedArray, canvasWidth: number, canvasHeight: number, 
                       startX: number, startY: number, startWidth: number, startHeight: number, 
                       contrastThreshold: number) => {
    let left = startX, right = startX + startWidth;
    let top = startY, bottom = startY + startHeight;
    
    // Expand horizontally
    let expandedLeft = true, expandedRight = true;
    while ((expandedLeft || expandedRight) && (right - left) < 200) { // Max size limit
      expandedLeft = false;
      expandedRight = false;
      
      // Try expanding left
      if (left > 0) {
        let hasContrast = false;
        for (let y = top; y < bottom && !hasContrast; y++) {
          const i = (y * canvasWidth + (left - 1)) * 4;
          const rightI = (y * canvasWidth + left) * 4;
          if (i >= 0 && rightI + 3 < data.length) {
            const leftBrightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const rightBrightness = (data[rightI] + data[rightI + 1] + data[rightI + 2]) / 3;
            if (Math.abs(leftBrightness - rightBrightness) > contrastThreshold) {
              hasContrast = true;
            }
          }
        }
        if (hasContrast) {
          left--;
          expandedLeft = true;
        }
      }
      
      // Try expanding right
      if (right < canvasWidth) {
        let hasContrast = false;
        for (let y = top; y < bottom && !hasContrast; y++) {
          const i = (y * canvasWidth + right) * 4;
          const leftI = (y * canvasWidth + (right - 1)) * 4;
          if (i + 3 < data.length && leftI >= 0) {
            const rightBrightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const leftBrightness = (data[leftI] + data[leftI + 1] + data[leftI + 2]) / 3;
            if (Math.abs(rightBrightness - leftBrightness) > contrastThreshold) {
              hasContrast = true;
            }
          }
        }
        if (hasContrast) {
          right++;
          expandedRight = true;
        }
      }
    }
    
    // Expand vertically (similar logic)
    let expandedTop = true, expandedBottom = true;
    while ((expandedTop || expandedBottom) && (bottom - top) < 200) {
      expandedTop = false;
      expandedBottom = false;
      
      if (top > 0) {
        let hasContrast = false;
        for (let x = left; x < right && !hasContrast; x++) {
          const i = ((top - 1) * canvasWidth + x) * 4;
          const bottomI = (top * canvasWidth + x) * 4;
          if (i >= 0 && bottomI + 3 < data.length) {
            const topBrightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const bottomBrightness = (data[bottomI] + data[bottomI + 1] + data[bottomI + 2]) / 3;
            if (Math.abs(topBrightness - bottomBrightness) > contrastThreshold) {
              hasContrast = true;
            }
          }
        }
        if (hasContrast) {
          top--;
          expandedTop = true;
        }
      }
      
      if (bottom < canvasHeight) {
        let hasContrast = false;
        for (let x = left; x < right && !hasContrast; x++) {
          const i = (bottom * canvasWidth + x) * 4;
          const topI = ((bottom - 1) * canvasWidth + x) * 4;
          if (i + 3 < data.length && topI >= 0) {
            const bottomBrightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const topBrightness = (data[topI] + data[topI + 1] + data[topI + 2]) / 3;
            if (Math.abs(bottomBrightness - topBrightness) > contrastThreshold) {
              hasContrast = true;
            }
          }
        }
        if (hasContrast) {
          bottom++;
          expandedBottom = true;
        }
      }
    }
    
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  };

  // Remove duplicate and overlapping elements
  const removeDuplicateElements = (features: DetectedFeature[]): DetectedFeature[] => {
    const filtered: DetectedFeature[] = [];
    
    features.sort((a, b) => b.confidence - a.confidence);
    
    for (const feature of features) {
      const overlaps = filtered.some(existing => {
        const overlapX = Math.max(0, Math.min(feature.boundingBox.x + feature.boundingBox.width, 
                                              existing.boundingBox.x + existing.boundingBox.width) - 
                                     Math.max(feature.boundingBox.x, existing.boundingBox.x));
        const overlapY = Math.max(0, Math.min(feature.boundingBox.y + feature.boundingBox.height, 
                                              existing.boundingBox.y + existing.boundingBox.height) - 
                                     Math.max(feature.boundingBox.y, existing.boundingBox.y));
        const overlapArea = overlapX * overlapY;
        const featureArea = feature.boundingBox.width * feature.boundingBox.height;
        const existingArea = existing.boundingBox.width * existing.boundingBox.height;
        
        // Consider overlapping if more than 50% of the smaller element overlaps
        return overlapArea > Math.min(featureArea, existingArea) * 0.5;
      });
      
      if (!overlaps) {
        filtered.push(feature);
      }
    }
    
    return filtered;
  };

  // Handle feature selection
  const handleFeatureClick = (feature: DetectedFeature) => {
    setSelectedFeature(feature);
    onFeatureSelect?.(feature);
    // Automatically trigger crop when clicking on a feature
    onCropRegion?.(feature.boundingBox);
  };

  // Handle crop region
  const handleCropFeature = (feature: DetectedFeature) => {
    onCropRegion?.(feature.boundingBox);
  };

  // Render feature overlays with type-specific styling
  const renderFeatureOverlays = () => {
    if (!canvasSize.width || !canvasSize.height) return null;

    return detectedFeatures.map(feature => {
      const isSelected = selectedFeature?.id === feature.id;
      const isHovered = hoveredFeature?.id === feature.id;
      
      // Color coding based on element type
      const getElementColor = (elementType: string) => {
        switch (elementType) {
          case 'text': return { border: 'border-blue-400', bg: 'bg-blue-400/15', badge: 'bg-blue-500' };
          case 'button': return { border: 'border-green-400', bg: 'bg-green-400/15', badge: 'bg-green-500' };
          case 'icon': return { border: 'border-purple-400', bg: 'bg-purple-400/15', badge: 'bg-purple-500' };
          case 'logo': return { border: 'border-orange-400', bg: 'bg-orange-400/15', badge: 'bg-orange-500' };
          case 'image': return { border: 'border-red-400', bg: 'bg-red-400/15', badge: 'bg-red-500' };
          case 'shape': return { border: 'border-yellow-400', bg: 'bg-yellow-400/15', badge: 'bg-yellow-500' };
          default: return { border: 'border-gray-400', bg: 'bg-gray-400/15', badge: 'bg-gray-500' };
        }
      };

      const elementColors = getElementColor(feature.elementType);
      
      return (
        <div
          key={feature.id}
          className={`absolute border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] ${
            isSelected 
              ? 'border-blue-500 bg-blue-500/30 shadow-lg' 
              : isHovered 
                ? 'border-yellow-400 bg-yellow-400/20 shadow-md' 
                : `${elementColors.border} ${elementColors.bg} hover:shadow-lg`
          }`}
          style={{
            left: `${feature.boundingBox.x}px`,
            top: `${feature.boundingBox.y}px`,
            width: `${feature.boundingBox.width}px`,
            height: `${feature.boundingBox.height}px`,
            boxShadow: isSelected ? '0 0 20px rgba(59, 130, 246, 0.5)' : isHovered ? '0 0 15px rgba(251, 191, 36, 0.4)' : '0 0 10px rgba(0, 0, 0, 0.2)',
          }}
          onClick={() => handleFeatureClick(feature)}
          onMouseEnter={() => setHoveredFeature(feature)}
          onMouseLeave={() => setHoveredFeature(null)}
          title={`Click to crop ${feature.label} (${Math.round(feature.confidence * 100)}% confidence)`}
        >
          {/* Feature label with element type indicator */}
          <div className="absolute -top-8 left-0 flex items-center gap-1 z-10">
            <Badge 
              variant="secondary" 
              className={`text-xs px-2 py-1 font-medium shadow-md text-white border-0 ${
                isSelected ? 'bg-blue-500' : elementColors.badge
              }`}
            >
              {feature.elementType === 'unknown' ? feature.label : `${feature.elementType}`}
              {feature.confidence && ` (${Math.round(feature.confidence * 100)}%)`}
              <span className="ml-1 text-xs opacity-75">📐</span>
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-6 w-6 p-0 bg-white/95 hover:bg-white border-gray-300 shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                handleCropFeature(feature);
              }}
              title="Crop this element"
            >
              <Scissors className="w-3 h-3" />
            </Button>
          </div>
          
          {/* Click indicator */}
          <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
            isHovered ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-200`}>
            <div className="bg-white/90 rounded-full p-2 shadow-lg">
              <Scissors className="w-4 h-4 text-gray-700" />
            </div>
          </div>

          {/* Center dot for small elements */}
          {(feature.boundingBox.width < 30 || feature.boundingBox.height < 30) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 bg-white rounded-full border border-gray-400"></div>
            </div>
          )}
        </div>
      );
    });
  };

  // Auto-detect when image changes, detection mode changes, or sensitivity changes
  useEffect(() => {
    if (imageSrc && isVisible) {
      detectFeatures();
    }
  }, [imageSrc, isVisible, detectionMode, sensitivity]);

  if (!isVisible || !imageSrc) return null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" />
          <span className="font-medium">AI Element Detection</span>
          {!modelLoaded && (
            <Badge variant="outline" className="text-xs">
              Loading model...
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Detection Mode Selector */}
          <select
            value={detectionMode}
            onChange={(e) => setDetectionMode(e.target.value as 'objects' | 'ui-elements' | 'edges')}
            className="text-xs px-2 py-1 border border-gray-300 rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          >
            <option value="ui-elements">UI Elements</option>
            <option value="objects">Objects</option>
          </select>
          
          {/* Sensitivity Selector */}
          <select
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value as 'low' | 'medium' | 'high')}
            className="text-xs px-2 py-1 border border-gray-300 rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white"
            title="Detection sensitivity - High finds smaller elements like logos"
          >
            <option value="high">High (finds logos)</option>
            <option value="medium">Medium</option>
            <option value="low">Low (main objects)</option>
          </select>
          
          <Button
            onClick={detectFeatures}
            size="sm"
            variant="outline"
            disabled={isLoading}
            className="flex items-center gap-1"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            {isLoading ? 'Analyzing...' : 'Detect'}
          </Button>
        </div>
      </div>

      {/* Detection Results */}
      {detectedFeatures.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Found {detectedFeatures.length} element{detectedFeatures.length !== 1 ? 's' : ''} with enhanced boundary detection. 
            <strong> Click on any highlighted area to automatically crop that element.</strong>
            {sensitivity === 'high' && ' (High sensitivity enabled for detecting logos and small graphics)'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            📐 Boundaries have been automatically refined by analyzing surrounding space for precise element isolation.
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-blue-400 bg-blue-400/15"></div>
              <span>Text</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-green-400 bg-green-400/15"></div>
              <span>Button</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-purple-400 bg-purple-400/15"></div>
              <span>Icon</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-orange-400 bg-orange-400/15"></div>
              <span>Logo</span>
            </div>
          </div>
        </div>
      )}

      {/* Canvas with overlays */}
      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          className="border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm"
          style={{ display: 'block' }}
        />
        
        {/* Feature overlays */}
        <div 
          ref={overlayRef}
          className="absolute inset-0 pointer-events-none"
          style={{ 
            width: `${canvasSize.width}px`, 
            height: `${canvasSize.height}px` 
          }}
        >
          <div className="relative w-full h-full pointer-events-auto">
            {renderFeatureOverlays()}
          </div>
        </div>
      </div>

      {/* Selected feature info */}
      {selectedFeature && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-blue-900 dark:text-blue-100">
                Selected: {selectedFeature.label}
              </h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Confidence: {Math.round(selectedFeature.confidence * 100)}%
              </p>
            </div>
            <Button
              onClick={() => handleCropFeature(selectedFeature)}
              size="sm"
              className="flex items-center gap-1"
            >
              <Scissors className="w-3 h-3" />
              Crop This Object
            </Button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Analyzing image with AI...
        </div>
      )}
    </div>
  );
};

export default MLFeatureDetector;
