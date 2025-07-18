import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Download, Upload, RotateCcw, Palette, Crop, ZoomIn, Eye, Moon, Sun, Plus, X, Eraser } from 'lucide-react';
import InteractiveElementDetector from './InteractiveElementDetector';
import CroppedResultsList from './CroppedResultsList';

interface ColorRangeSelectorProps {
  className?: string;
}

interface ColorRangeSelectorRef {
  handleExternalImage: (img: HTMLImageElement) => void;
}

interface ColorInfo {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ColorRangeSelector = forwardRef<ColorRangeSelectorRef, ColorRangeSelectorProps>(({ className }, ref) => {
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [croppedImage, setCroppedImage] = useState<HTMLImageElement | null>(null);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [detectedColors, setDetectedColors] = useState<Array<{ color: string; count: number; rgb: ColorInfo }>>([]);
  const [tolerance, setTolerance] = useState<number>(25);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isCropMode, setIsCropMode] = useState<boolean>(false);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [showRedBackground, setShowRedBackground] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [cropMode, setCropMode] = useState<'rectangle' | 'circle'>('rectangle');
  const [activeCircularMask, setActiveCircularMask] = useState<{ centerX: number; centerY: number; radius: number } | null>(null);
  const [desaturateResult, setDesaturateResult] = useState<boolean>(false);
  const [showInteractiveDetection, setShowInteractiveDetection] = useState<boolean>(false);
  const [interactiveImageSrc, setInteractiveImageSrc] = useState<string | null>(null);
  const [croppedResults, setCroppedResults] = useState<any[]>([]);
  const [previewElement, setPreviewElement] = useState<{imageData: string, element: any} | null>(null);
  const [backgroundRemoved, setBackgroundRemoved] = useState<boolean>(false);
  const [backgroundRemovalThreshold, setBackgroundRemovalThreshold] = useState<number>(25);
  const [selectedElements, setSelectedElements] = useState<any[]>([]);
  const [currentStep, setCurrentStep] = useState<'input' | 'detection' | 'processing'>('input');
  const [currentProcessingElement, setCurrentProcessingElement] = useState<any | null>(null);
  const [savedAssets, setSavedAssets] = useState<Array<{
    id: string;
    name: string;
    imageData: string;
    timestamp: number;
    type: 'color-selection' | 'background-removed' | 'cropped';
    metadata?: {
      colors?: string[];
      dimensions?: { width: number; height: number };
      elementType?: string;
    };
  }>>([]);
  const [showAssetsPanel, setShowAssetsPanel] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  // Function to handle external images (from URL or clipboard)
  const handleExternalImage = (img: HTMLImageElement) => {
    console.log('External image loaded');
    setOriginalImage(img);
    setCroppedImage(null);
    setSelectedColors(new Set());
    setDetectedColors([]);
    setIsCropMode(false);
    setCropArea(null);
    setActiveCircularMask(null);
    setBackgroundRemoved(false);
    setSelectedElements([]);
    setCurrentStep('detection'); // Move to detection step
    
    // Use setTimeout to ensure the component has re-rendered with the new image
    setTimeout(() => {
      drawOriginalImage(img);
      analyzeImageColors(img);
      // Update image source for interactive detection
      setInteractiveImageSrc(img.src);
      setShowInteractiveDetection(true); // Automatically show interactive detection
    }, 0);
  };

  // Expose handleExternalImage to parent components via ref
  useImperativeHandle(ref, () => ({
    handleExternalImage
  }), []);

  const colorDistance = (color1: ColorInfo, color2: ColorInfo): number => {
    // Use weighted Euclidean distance that better matches human perception
    // Red and green differences are weighted more heavily than blue
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    
    // Weights based on human eye sensitivity
    const weightR = 0.3;
    const weightG = 0.59;
    const weightB = 0.11;
    
    return Math.sqrt(weightR * dr * dr + weightG * dg * dg + weightB * db * db);
  };

  const getPixelColor = (imageData: ImageData, x: number, y: number): ColorInfo => {
    const index = (y * imageData.width + x) * 4;
    return {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2],
      a: imageData.data[index + 3]
    };
  };

  const colorToString = (color: ColorInfo): string => {
    return `${color.r},${color.g},${color.b}`;
  };

  // Helper function to desaturate a color (convert to grayscale)
  const desaturateColor = (r: number, g: number, b: number): { r: number; g: number; b: number } => {
    // Using luminance formula for better grayscale conversion
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    return { r: gray, g: gray, b: gray };
  };

  // Helper function to calculate color brightness (luminance)
  const getColorBrightness = (r: number, g: number, b: number): number => {
    // Using relative luminance formula
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };

  // Helper function to calculate color saturation
  const getColorSaturation = (r: number, g: number, b: number): number => {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    return max === 0 ? 0 : (max - min) / max;
  };

  // Helper function to classify colors
  const classifyColor = (r: number, g: number, b: number) => {
    const brightness = getColorBrightness(r, g, b);
    const saturation = getColorSaturation(r, g, b);
    
    const isDark = brightness < 0.3;
    const isLight = brightness > 0.7;
    const isColorful = saturation > 0.3; // Has significant color content
    
    return { isDark, isLight, isColorful, brightness, saturation };
  };

  // Contrast-based circle detection algorithm - REMOVED
  // Using manual circle selection with arrow key movement instead

  const analyzeImageColors = (img: HTMLImageElement, circularMask?: { centerX: number; centerY: number; radius: number }) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use a smaller canvas for color analysis to improve performance
    const analysisCanvas = document.createElement('canvas');
    const analysisCtx = analysisCanvas.getContext('2d');
    if (!analysisCtx) return;

    // Scale down for analysis (max 200x200 for performance)
    const maxSize = 200;
    const ratio = Math.min(maxSize / img.width, maxSize / img.height);
    analysisCanvas.width = Math.floor(img.width * ratio);
    analysisCanvas.height = Math.floor(img.height * ratio);

    analysisCtx.drawImage(img, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const imageData = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);

    // Scale the circular mask to match the analysis canvas
    let scaledMask: { centerX: number; centerY: number; radius: number } | undefined;
    if (circularMask) {
      scaledMask = {
        centerX: circularMask.centerX * ratio,
        centerY: circularMask.centerY * ratio,
        radius: circularMask.radius * ratio
      };
    }

    // Count colors with improved quantization that preserves red/orange distinctions
    const colorMap = new Map<string, { count: number; rgb: ColorInfo }>();
    
    // Use adaptive quantization - less aggressive for warm colors (red, orange, yellow)
    const getQuantizationLevel = (r: number, g: number, b: number): number => {
      // Check if this is a warm color (red, orange, yellow)
      const isWarmColor = r > g && r > b; // Red dominant
      const isOrange = r > 150 && g > 50 && g < 200 && b < 150; // Orange range
      const isYellow = r > 200 && g > 200 && b < 150; // Yellow range
      
      if (isWarmColor || isOrange || isYellow) {
        return 8; // Less aggressive quantization for warm colors
      }
      return 16; // Standard quantization for other colors
    };

    for (let y = 0; y < analysisCanvas.height; y++) {
      for (let x = 0; x < analysisCanvas.width; x++) {
        const i = (y * analysisCanvas.width + x) * 4;
        
        // Check if pixel is within circular mask (if provided)
        if (scaledMask) {
          const dx = x - scaledMask.centerX;
          const dy = y - scaledMask.centerY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > scaledMask.radius) {
            continue; // Skip pixels outside the circle
          }
        }
        
        const originalR = imageData.data[i];
        const originalG = imageData.data[i + 1];
        const originalB = imageData.data[i + 2];
        const a = imageData.data[i + 3];

        // Skip transparent pixels
        if (a < 128) continue;

        const quantize = getQuantizationLevel(originalR, originalG, originalB);
        const r = Math.floor(originalR / quantize) * quantize;
        const g = Math.floor(originalG / quantize) * quantize;
        const b = Math.floor(originalB / quantize) * quantize;

        const colorKey = `${r},${g},${b}`;
        
        
        if (colorMap.has(colorKey)) {
          colorMap.get(colorKey)!.count++;
        } else {
          colorMap.set(colorKey, {
            count: 1,
            rgb: { r, g, b, a: 255 }
          });
        }
      }
    }

    // Sort colors by frequency and take top colors
    const sortedColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({
        color,
        count: data.count,
        rgb: data.rgb
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 32); // Show top 32 colors to capture more color variations

    console.log('Detected colors:', sortedColors.map(c => ({
      color: c.color,
      count: c.count,
      isWarm: c.rgb.r > c.rgb.g && c.rgb.r > c.rgb.b,
      isRed: c.rgb.r > 150 && c.rgb.g < 100 && c.rgb.b < 100,
      isOrange: c.rgb.r > 150 && c.rgb.g > 50 && c.rgb.g < 200 && c.rgb.b < 150
    })));

    if (circularMask) {
      console.log('Color analysis within circle:', {
        center: `(${Math.round(circularMask.centerX)}, ${Math.round(circularMask.centerY)})`,
        radius: Math.round(circularMask.radius),
        colorsFound: sortedColors.length
      });
    }

    setDetectedColors(sortedColors);
  };

  const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const displayClickX = event.clientX - rect.left;
    const displayClickY = event.clientY - rect.top;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      display: { x: displayClickX, y: displayClickY },
      actual: { 
        x: Math.floor(displayClickX * scaleX), 
        y: Math.floor(displayClickY * scaleY) 
      }
    };
  };

  const drawCropOverlay = () => {
    const canvas = originalCanvasRef.current;
    if (!canvas || !cropArea) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw the current working image first (cropped or original)
    const workingImage = croppedImage || originalImage;
    if (workingImage) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(workingImage, 0, 0, canvas.width, canvas.height);
    }

    // Draw crop overlay
    ctx.save();
    
    // Draw dark overlay over entire image
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Clear the crop area (make it bright)
    ctx.globalCompositeOperation = 'destination-out';
    
    if (cropMode === 'rectangle') {
      ctx.fillRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    } else if (cropMode === 'circle') {
      // For circle, clear a circular area
      const centerX = cropArea.x + cropArea.width / 2;
      const centerY = cropArea.y + cropArea.height / 2;
      const radius = Math.min(cropArea.width, cropArea.height) / 2;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    
    // Draw crop border
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    
    if (cropMode === 'rectangle') {
      ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    } else if (cropMode === 'circle') {
      const centerX = cropArea.x + cropArea.width / 2;
      const centerY = cropArea.y + cropArea.height / 2;
      const radius = Math.min(cropArea.width, cropArea.height) / 2;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    
    ctx.restore();

    // Update active circular mask if in circle mode (but don't trigger immediate re-analysis)
    if (cropMode === 'circle') {
      const centerX = cropArea.x + cropArea.width / 2;
      const centerY = cropArea.y + cropArea.height / 2;
      const radius = Math.min(cropArea.width, cropArea.height) / 2;
      
      const newMask = { centerX, centerY, radius };
      
      // Only update if the mask has actually changed to prevent unnecessary re-renders
      setActiveCircularMask(prevMask => {
        if (!prevMask || 
            Math.abs(prevMask.centerX - newMask.centerX) > 1 ||
            Math.abs(prevMask.centerY - newMask.centerY) > 1 ||
            Math.abs(prevMask.radius - newMask.radius) > 1) {
          return newMask;
        }
        return prevMask;
      });
    } else {
      setActiveCircularMask(null);
    }
  };

  // Circle detection removed - using manual circle positioning with arrow keys

  const applyCrop = () => {
    const workingImage = croppedImage || originalImage;
    if (!workingImage || !cropArea) return;

    const croppedCanvas = document.createElement('canvas');
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to crop dimensions
    croppedCanvas.width = cropArea.width;
    croppedCanvas.height = cropArea.height;

    // Draw the cropped portion from the current working image
    ctx.drawImage(
      workingImage,
      cropArea.x, cropArea.y, cropArea.width, cropArea.height,
      0, 0, cropArea.width, cropArea.height
    );

    // Convert to image
    croppedCanvas.toBlob((blob) => {
      if (!blob) return;
      
      const img = new Image();
      img.onload = () => {
        setCroppedImage(img);
        drawOriginalImage(img); // This will now draw the cropped image
        analyzeImageColors(img);
        setSelectedColors(new Set());
        setDetectedColors([]);
        
        // Exit crop mode
        setIsCropMode(false);
        setCropArea(null);
      };
      img.src = URL.createObjectURL(blob);
    });
  };

  // Handle ML-detected crop regions
  const handleMLCropRegion = (region: { x: number; y: number; width: number; height: number }) => {
    console.log('ML detected crop region:', region);
    // Set the crop area to the detected region
    setCropArea(region);
    setIsCropMode(true);
    setCropMode('rectangle');
    
    // Automatically apply the crop after a short delay to show the selection
    setTimeout(() => {
      applyCrop();
      // Hide interactive detection after cropping
      setShowInteractiveDetection(false);
    }, 1500);
  };

  // Handle ML feature selection (for future enhancements)
  const handleMLFeatureSelect = (feature: any) => {
    console.log('ML feature selected:', feature);
    // Could be used for additional feature-specific processing
  };

  // Handle cropped results from interactive detection
  const handleCroppedResult = (result: any) => {
    setCroppedResults(prev => [result, ...prev]);
  };

  // Add element to selected elements list for processing
  const addElementToProcessingList = (element: any) => {
    console.log('Adding element to processing list:', element);
    const newElement = {
      id: `element_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...element,
      timestamp: Date.now()
    };
    setSelectedElements(prev => [newElement, ...prev]);
  };

  // Remove element from processing list
  const removeElementFromProcessingList = (elementId: string) => {
    setSelectedElements(prev => prev.filter(el => el.id !== elementId));
  };

  // Process selected element with current color settings
  const processSelectedElement = (element: any) => {
    console.log('Processing element with current color settings:', element);
    setCurrentProcessingElement(element);
    setCurrentStep('processing');
    
    // Load the element image into the source canvas for color detection
    const img = new Image();
    img.onload = () => {
      // Set this as the working image for color detection
      drawOriginalImage(img);
      analyzeImageColors(img);
      
      // Clear previous color selections to start fresh
      setSelectedColors(new Set());
      setBackgroundRemoved(false);
    };
    img.src = element.imageData;
  };

  // Move to processing step (kept for compatibility but not used in current workflow)
  const startProcessing = () => {
    if (selectedElements.length > 0) {
      // Instead of moving to processing step, show options to process individual elements
      console.log(`${selectedElements.length} elements available for individual processing`);
    } else {
      alert('Please select at least one element to process');
    }
  };

  // Return to element selection from processing
  const returnToElementSelection = () => {
    setCurrentStep('detection');
    setCurrentProcessingElement(null);
    
    // Restore the original image
    if (originalImage) {
      drawOriginalImage(originalImage);
      analyzeImageColors(originalImage);
    }
    
    // Clear processing state
    setSelectedColors(new Set());
    setBackgroundRemoved(false);
  };

  // Handle preview from interactive detection
  const handleShowPreview = (imageData: string, element: any) => {
    setPreviewElement({ imageData, element });
    
    // Create an image from the cropped data and display it in the results canvas
    const previewImg = new Image();
    previewImg.onload = () => {
      const resultCanvas = resultCanvasRef.current;
      if (!resultCanvas) return;
      
      const ctx = resultCanvas.getContext('2d');
      if (!ctx) return;
      
      // Set canvas size to match the preview image
      resultCanvas.width = previewImg.width;
      resultCanvas.height = previewImg.height;
      
      // Calculate display size maintaining aspect ratio
      const maxDisplayWidth = 450;
      const maxDisplayHeight = 350;
      const displayRatio = Math.min(maxDisplayWidth / previewImg.width, maxDisplayHeight / previewImg.height);
      
      const displayWidth = Math.floor(previewImg.width * displayRatio);
      const displayHeight = Math.floor(previewImg.height * displayRatio);
      
      resultCanvas.style.width = `${displayWidth}px`;
      resultCanvas.style.height = `${displayHeight}px`;
      
      // Clear and draw the preview image
      ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      ctx.drawImage(previewImg, 0, 0);
      
      // Apply color filtering if colors are selected
      if (selectedColors.size > 0) {
        const imageData = ctx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
        const resultData = ctx.createImageData(resultCanvas.width, resultCanvas.height);
        
        // Convert selected colors to ColorInfo objects
        const selectedColorObjects = Array.from(selectedColors).map(color => {
          const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (match) {
            return {
              r: parseInt(match[1]),
              g: parseInt(match[2]),
              b: parseInt(match[3]),
              a: 255
            };
          }
          return { r: 0, g: 0, b: 0, a: 255 };
        });
        
        // Process each pixel
        for (let i = 0; i < imageData.data.length; i += 4) {
          const pixelColor = {
            r: imageData.data[i],
            g: imageData.data[i + 1],
            b: imageData.data[i + 2],
            a: imageData.data[i + 3]
          };

          let isSelected = false;
          
          // Check if pixel color matches any selected color within tolerance
          for (const selectedColor of selectedColorObjects) {
            const dist = colorDistance(pixelColor, selectedColor);
            if (dist <= tolerance) {
              isSelected = true;
              break;
            }
          }

          if (isSelected) {
            // Keep the original color with full opacity
            if (desaturateResult) {
              const desaturated = desaturateColor(
                imageData.data[i],
                imageData.data[i + 1],
                imageData.data[i + 2]
              );
              resultData.data[i] = desaturated.r;
              resultData.data[i + 1] = desaturated.g;
              resultData.data[i + 2] = desaturated.b;
              resultData.data[i + 3] = 255;
            } else {
              resultData.data[i] = imageData.data[i];
              resultData.data[i + 1] = imageData.data[i + 1];
              resultData.data[i + 2] = imageData.data[i + 2];
              resultData.data[i + 3] = 255;
            }
          } else {
            // Make transparent
            resultData.data[i] = 0;
            resultData.data[i + 1] = 0;
            resultData.data[i + 2] = 0;
            resultData.data[i + 3] = 0;
          }
        }
        
        // Apply the filtered result
        ctx.putImageData(resultData, 0, 0);
      }
    };
    previewImg.src = imageData;
  };

  // Add preview to cropped results list
  const addPreviewToResults = () => {
    if (previewElement) {
      const result = {
        id: `crop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        region: {
          ...previewElement.element.boundingBox,
          confidence: previewElement.element.confidence,
          elementType: previewElement.element.elementType
        },
        imageData: previewElement.imageData,
        selectedColors: new Set(selectedColors),
        timestamp: Date.now()
      };
      setCroppedResults(prev => [result, ...prev]);
      setPreviewElement(null); // Clear preview after adding
    }
  };

  // Delete a cropped result
  const deleteCroppedResult = (id: string) => {
    setCroppedResults(prev => prev.filter(result => result.id !== id));
  };

  // Download cropped result
  const downloadCroppedResult = (result: any) => {
    // This will be handled by the CroppedResultsList component
    console.log('Downloading result:', result.id);
  };

  // Preview cropped result
  const previewCroppedResult = (result: any) => {
    // Could open a modal or highlight the result
    console.log('Previewing result:', result.id);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('File selected:', file.name, file.type);

    const img = new Image();
    img.onload = () => {
      console.log('Image loaded successfully');
      setOriginalImage(img);
      setCroppedImage(null);
      setSelectedColors(new Set());
      setDetectedColors([]);
      setIsCropMode(false);
      setCropArea(null);
      setActiveCircularMask(null);
      setBackgroundRemoved(false);
      setSelectedElements([]);
      setCurrentStep('detection'); // Move to detection step
      
      // Use setTimeout to ensure the component has re-rendered with the new image
      setTimeout(() => {
        drawOriginalImage(img);
        analyzeImageColors(img);
        // Update image source for interactive detection
        setInteractiveImageSrc(img.src);
        setShowInteractiveDetection(true); // Automatically show interactive detection
      }, 0);
    };
    img.onerror = (error) => {
      console.error('Error loading image:', error);
    };
    img.src = URL.createObjectURL(file);
  };

  const drawOriginalImage = (img: HTMLImageElement) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) {
      console.error('Canvas ref not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Canvas context not found');
      return;
    }

    // Set canvas size to match container max size while maintaining aspect ratio for DISPLAY
    const maxDisplayWidth = 450;
    const maxDisplayHeight = 350;
    const ratio = Math.min(maxDisplayWidth / img.width, maxDisplayHeight / img.height);
    
    const displayWidth = Math.floor(img.width * ratio);
    const displayHeight = Math.floor(img.height * ratio);
    
    // Set canvas internal resolution to ORIGINAL image size for high quality processing
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Set canvas display size to fit container
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    
    // Clear canvas first
    ctx.clearRect(0, 0, img.width, img.height);
    
    // Draw the image at FULL RESOLUTION
    ctx.drawImage(img, 0, 0, img.width, img.height);
    
    console.log('Image drawn:', { 
      originalSize: `${img.width}x${img.height}`, 
      displaySize: `${displayWidth}x${displayHeight}`,
      canvasInternalSize: `${canvas.width}x${canvas.height}`,
      canvasDisplaySize: `${canvas.style.width}x${canvas.style.height}`
    });
  };

  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isCropMode) return; // Disable color selection in crop mode
    
    const canvas = originalCanvasRef.current;
    if (!canvas || !originalImage) return;

    const rect = canvas.getBoundingClientRect();
    
    // Calculate click position relative to the displayed canvas
    const displayClickX = event.clientX - rect.left;
    const displayClickY = event.clientY - rect.top;
    
    // Convert display coordinates to actual canvas coordinates
    // Since canvas internal size is full resolution but display is scaled
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const actualX = Math.floor(displayClickX * scaleX);
    const actualY = Math.floor(displayClickY * scaleY);
    
    // Ensure coordinates are within bounds
    const x = Math.max(0, Math.min(actualX, canvas.width - 1));
    const y = Math.max(0, Math.min(actualY, canvas.height - 1));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const clickedColor = getPixelColor(imageData, x, y);
    const colorString = colorToString(clickedColor);

    console.log('Click coordinates:', {
      display: `${displayClickX}, ${displayClickY}`,
      actual: `${x}, ${y}`,
      color: `rgb(${clickedColor.r}, ${clickedColor.g}, ${clickedColor.b})`
    });

    setSelectedColors(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(colorString)) {
        newSelected.delete(colorString);
      } else {
        newSelected.add(colorString);
      }
      
      // Reset background removed state when colors change
      setBackgroundRemoved(false);
      
      // Immediately process with the current circular mask
      setTimeout(() => {
        if (newSelected.size > 0) {
          processImage(activeCircularMask || undefined);
        }
      }, 0);
      
      return newSelected;
    });
  }, [originalImage, isCropMode]);

  const handleCanvasMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCropMode) return;
    
    const coords = getCanvasCoordinates(event);
    if (!coords) return;

    setIsDrawing(true);
    setStartPoint(coords.actual);
    setCropArea(null);
  }, [isCropMode]);

  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCropMode || !isDrawing || !startPoint) return;
    
    const coords = getCanvasCoordinates(event);
    if (!coords) return;

    if (cropMode === 'rectangle') {
      const newCropArea = {
        x: Math.min(startPoint.x, coords.actual.x),
        y: Math.min(startPoint.y, coords.actual.y),
        width: Math.abs(coords.actual.x - startPoint.x),
        height: Math.abs(coords.actual.y - startPoint.y)
      };
      setCropArea(newCropArea);
    } else if (cropMode === 'circle') {
      // For circle, calculate radius from center to current point
      const dx = coords.actual.x - startPoint.x;
      const dy = coords.actual.y - startPoint.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      
      // Create a square crop area that contains the circle
      const newCropArea = {
        x: Math.max(0, startPoint.x - radius),
        y: Math.max(0, startPoint.y - radius),
        width: radius * 2,
        height: radius * 2
      };
      setCropArea(newCropArea);
    }
  }, [isCropMode, isDrawing, startPoint, cropMode]);

  const handleCanvasMouseUp = useCallback(() => {
    if (!isCropMode) return;
    setIsDrawing(false);
  }, [isCropMode]);

  const processImage = useCallback((circularMask?: { centerX: number; centerY: number; radius: number }) => {
    const workingImage = croppedImage || originalImage;
    if (!workingImage || selectedColors.size === 0) return;

    setIsProcessing(true);
    
    setTimeout(() => {
      const originalCanvas = originalCanvasRef.current;
      const resultCanvas = resultCanvasRef.current;
      
      if (!originalCanvas || !resultCanvas) {
        setIsProcessing(false);
        return;
      }

      const originalCtx = originalCanvas.getContext('2d');
      const resultCtx = resultCanvas.getContext('2d');
      
      if (!originalCtx || !resultCtx) {
        setIsProcessing(false);
        return;
      }

      // If we have a circular mask, size the result canvas to the circle
      if (circularMask) {
        const { centerX, centerY, radius } = circularMask;
        
        // Calculate the square bounds that contain the circle
        const cropX = Math.max(0, Math.floor(centerX - radius));
        const cropY = Math.max(0, Math.floor(centerY - radius));
        const cropSize = Math.ceil(radius * 2);
        
        // Set result canvas to circle size
        resultCanvas.width = cropSize;
        resultCanvas.height = cropSize;
        
        // Calculate display size maintaining aspect ratio
        const maxDisplayWidth = 450;
        const maxDisplayHeight = 350;
        const displayRatio = Math.min(maxDisplayWidth / cropSize, maxDisplayHeight / cropSize);
        
        const displayWidth = Math.floor(cropSize * displayRatio);
        const displayHeight = Math.floor(cropSize * displayRatio);
        
        resultCanvas.style.width = `${displayWidth}px`;
        resultCanvas.style.height = `${displayHeight}px`;
        
        console.log('Processing circular crop at full resolution:', {
          circleSize: `${cropSize}x${cropSize}`,
          displaySize: `${displayWidth}x${displayHeight}`,
          center: `(${Math.round(centerX)}, ${Math.round(centerY)})`,
          radius: Math.round(radius)
        });

        // Clear canvas
        resultCtx.clearRect(0, 0, cropSize, cropSize);

        // Fill with red background if enabled
        if (showRedBackground) {
          resultCtx.fillStyle = '#ff0000';
          resultCtx.fillRect(0, 0, cropSize, cropSize);
        }

        // Get the original image data (without any overlays)
        const originalImageToUse = croppedImage || originalImage;
        if (!originalImageToUse) {
          setIsProcessing(false);
          return;
        }

        // Create a clean canvas with just the original image data
        const cleanCanvas = document.createElement('canvas');
        const cleanCtx = cleanCanvas.getContext('2d');
        if (!cleanCtx) {
          setIsProcessing(false);
          return;
        }

        cleanCanvas.width = originalCanvas.width;
        cleanCanvas.height = originalCanvas.height;
        cleanCtx.drawImage(originalImageToUse, 0, 0, cleanCanvas.width, cleanCanvas.height);
        
        const imageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
        const resultData = resultCtx.createImageData(cropSize, cropSize);

        // Convert selected colors to ColorInfo objects
        const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
          const [r, g, b] = colorStr.split(',').map(Number);
          return { r, g, b, a: 255 };
        });

        // Calculate the circle center relative to the cropped area
        const relativeCenterX = centerX - cropX;
        const relativeCenterY = centerY - cropY;

        // Process each pixel in the circular area
        for (let y = 0; y < cropSize; y++) {
          for (let x = 0; x < cropSize; x++) {
            const resultIndex = (y * cropSize + x) * 4;
            
            // Calculate distance from circle center
            const dx = x - relativeCenterX;
            const dy = y - relativeCenterY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Check if pixel is within the circle
            if (distance <= radius) {
              // Get the original image coordinates
              const originalX = cropX + x;
              const originalY = cropY + y;
              
              // Make sure we're within the original image bounds
              if (originalX >= 0 && originalX < originalCanvas.width && 
                  originalY >= 0 && originalY < originalCanvas.height) {
                
                const originalIndex = (originalY * originalCanvas.width + originalX) * 4;
                
                const pixelColor = {
                  r: imageData.data[originalIndex],
                  g: imageData.data[originalIndex + 1],
                  b: imageData.data[originalIndex + 2],
                  a: imageData.data[originalIndex + 3]
                };

                let isSelected = false;
                let minDistance = Infinity;
                
                // Check if pixel color matches any selected color within tolerance
                for (const selectedColor of selectedColorObjects) {
                  const dist = colorDistance(pixelColor, selectedColor);
                  minDistance = Math.min(minDistance, dist);
                  if (dist <= tolerance) {
                    isSelected = true;
                    break;
                  }
                }

                if (isSelected) {
                  // Keep the original color with full opacity (or desaturated if enabled)
                  if (desaturateResult) {
                    const desaturated = desaturateColor(
                      imageData.data[originalIndex],
                      imageData.data[originalIndex + 1],
                      imageData.data[originalIndex + 2]
                    );
                    resultData.data[resultIndex] = desaturated.r;
                    resultData.data[resultIndex + 1] = desaturated.g;
                    resultData.data[resultIndex + 2] = desaturated.b;
                    resultData.data[resultIndex + 3] = 255; // Full opacity
                  } else {
                    resultData.data[resultIndex] = imageData.data[originalIndex];
                    resultData.data[resultIndex + 1] = imageData.data[originalIndex + 1];
                    resultData.data[resultIndex + 2] = imageData.data[originalIndex + 2];
                    resultData.data[resultIndex + 3] = 255; // Full opacity
                  }
                } else if (showRedBackground) {
                  // Show red background for unselected pixels
                  const isCloseToRedOrange = selectedColorObjects.some(selectedColor => {
                    const isRedOrangeSelected = selectedColor.r > selectedColor.g && selectedColor.r > selectedColor.b;
                    return isRedOrangeSelected && minDistance < tolerance * 1.5;
                  });
                  
                  if (isCloseToRedOrange) {
                    resultData.data[resultIndex] = 0;     // Black background
                    resultData.data[resultIndex + 1] = 0;
                    resultData.data[resultIndex + 2] = 0;
                    resultData.data[resultIndex + 3] = 255;
                  } else {
                    resultData.data[resultIndex] = 255;   // Red background
                    resultData.data[resultIndex + 1] = 0;
                    resultData.data[resultIndex + 2] = 0;
                    resultData.data[resultIndex + 3] = 255;
                  }
                } else {
                  // Make transparent
                  resultData.data[resultIndex] = 0;
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 0;
                }
              } else {
                // Outside original image bounds
                if (showRedBackground) {
                  resultData.data[resultIndex] = 255;   // Red background
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 255;
                } else {
                  resultData.data[resultIndex] = 0;
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 0;
                }
              }
            } else {
              // Outside circle - make transparent
              resultData.data[resultIndex] = 0;
              resultData.data[resultIndex + 1] = 0;
              resultData.data[resultIndex + 2] = 0;
              resultData.data[resultIndex + 3] = 0;
            }
          }
        }

        resultCtx.putImageData(resultData, 0, 0);
        setIsProcessing(false);
        return;
      }

      // Original rectangular processing
      resultCanvas.width = originalCanvas.width;
      resultCanvas.height = originalCanvas.height;
      
      resultCanvas.style.width = originalCanvas.style.width;
      resultCanvas.style.height = originalCanvas.style.height;

      console.log('Processing at full resolution:', {
        size: `${resultCanvas.width}x${resultCanvas.height}`,
        displaySize: `${resultCanvas.style.width}x${resultCanvas.style.height}`,
        workingImage: croppedImage ? 'cropped' : 'original',
        redBackground: showRedBackground
      });

      resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

      if (showRedBackground) {
        resultCtx.fillStyle = '#ff0000';
        resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);
      }

      const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
      const resultData = resultCtx.createImageData(imageData.width, imageData.height);

      const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
        const [r, g, b] = colorStr.split(',').map(Number);
        return { r, g, b, a: 255 };
      });

      for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
          const i = (y * imageData.width + x) * 4;
          
          const pixelColor = {
            r: imageData.data[i],
            g: imageData.data[i + 1],
            b: imageData.data[i + 2],
            a: imageData.data[i + 3]
          };

          let isSelected = false;
          let minDistance = Infinity;
          
          for (const selectedColor of selectedColorObjects) {
            const distance = colorDistance(pixelColor, selectedColor);
            minDistance = Math.min(minDistance, distance);
            if (distance <= tolerance) {
              isSelected = true;
              break;
            }
          }

          if (isSelected) {
            if (desaturateResult) {
              const desaturated = desaturateColor(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
              resultData.data[i] = desaturated.r;
              resultData.data[i + 1] = desaturated.g;
              resultData.data[i + 2] = desaturated.b;
              resultData.data[i + 3] = imageData.data[i + 3];
            } else {
              resultData.data[i] = imageData.data[i];
              resultData.data[i + 1] = imageData.data[i + 1];
              resultData.data[i + 2] = imageData.data[i + 2];
              resultData.data[i + 3] = imageData.data[i + 3];
            }
          } else if (showRedBackground) {
            const isCloseToRedOrange = selectedColorObjects.some(selectedColor => {
              const isRedOrangeSelected = selectedColor.r > selectedColor.g && selectedColor.r > selectedColor.b;
              return isRedOrangeSelected && minDistance < tolerance * 1.5;
            });
            
            if (isCloseToRedOrange) {
              resultData.data[i] = 0;
              resultData.data[i + 1] = 0;
              resultData.data[i + 2] = 0;
              resultData.data[i + 3] = 255;
            } else {
              resultData.data[i] = 255;
              resultData.data[i + 1] = 0;
              resultData.data[i + 2] = 0;
              resultData.data[i + 3] = 255;
            }
          } else {
            resultData.data[i] = 0;
            resultData.data[i + 1] = 0;
            resultData.data[i + 2] = 0;
            resultData.data[i + 3] = 0;
          }
        }
      }

      resultCtx.putImageData(resultData, 0, 0);
      setIsProcessing(false);
    }, 100);
  }, [croppedImage, originalImage, selectedColors, tolerance, showRedBackground, desaturateResult]);

  // Asset Management Functions
  const saveAssetToStorage = (canvas: HTMLCanvasElement, type: 'color-selection' | 'background-removed' | 'cropped', customName?: string) => {
    return new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve();
          return;
        }
        
        const reader = new FileReader();
        reader.onload = () => {
          const imageData = reader.result as string;
          const timestamp = Date.now();
          const elementInfo = currentProcessingElement ? ` - ${currentProcessingElement.elementType}` : '';
          const defaultName = customName || `${type}${elementInfo} - ${new Date(timestamp).toLocaleString()}`;
          
          const asset = {
            id: `asset_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
            name: defaultName,
            imageData,
            timestamp,
            type,
            metadata: {
              colors: Array.from(selectedColors),
              dimensions: { width: canvas.width, height: canvas.height },
              elementType: currentProcessingElement?.elementType
            }
          };
          
          setSavedAssets(prev => [asset, ...prev]);
          
          // Also save to localStorage for persistence
          try {
            const existingAssets = JSON.parse(localStorage.getItem('colorRangeAssets') || '[]');
            const updatedAssets = [asset, ...existingAssets].slice(0, 50); // Keep only latest 50 assets
            localStorage.setItem('colorRangeAssets', JSON.stringify(updatedAssets));
          } catch (error) {
            console.warn('Failed to save to localStorage:', error);
          }
          
          resolve();
        };
        reader.readAsDataURL(blob);
      }, 'image/png');
    });
  };

  const saveAsset = async () => {
    const canvas = resultCanvasRef.current;
    const originalCanvas = originalCanvasRef.current;
    
    if (!canvas || !originalCanvas) return;

    setIsProcessing(true);

    try {
      if (activeCircularMask) {
        // Handle circular crop case - create the same canvas as downloadResult would
        const { centerX, centerY, radius } = activeCircularMask;
        const cropX = Math.max(0, Math.floor(centerX - radius));
        const cropY = Math.max(0, Math.floor(centerY - radius));
        const cropSize = Math.ceil(radius * 2);
        
        const circularCanvas = document.createElement('canvas');
        const circularCtx = circularCanvas.getContext('2d');
        if (!circularCtx) return;

        circularCanvas.width = cropSize;
        circularCanvas.height = cropSize;

        const originalImageToUse = croppedImage || originalImage;
        if (!originalImageToUse) return;

        const cleanCanvas = document.createElement('canvas');
        const cleanCtx = cleanCanvas.getContext('2d');
        if (!cleanCtx) return;

        cleanCanvas.width = originalCanvas.width;
        cleanCanvas.height = originalCanvas.height;
        cleanCtx.drawImage(originalImageToUse, 0, 0, cleanCanvas.width, cleanCanvas.height);
        
        const imageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
        const resultData = circularCtx.createImageData(cropSize, cropSize);

        const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
          const [r, g, b] = colorStr.split(',').map(Number);
          return { r, g, b, a: 255 };
        });

        const relativeCenterX = centerX - cropX;
        const relativeCenterY = centerY - cropY;

        for (let y = 0; y < cropSize; y++) {
          for (let x = 0; x < cropSize; x++) {
            const resultIndex = (y * cropSize + x) * 4;
            const dx = x - relativeCenterX;
            const dy = y - relativeCenterY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= radius) {
              const originalX = cropX + x;
              const originalY = cropY + y;
              
              if (originalX >= 0 && originalX < originalCanvas.width && 
                  originalY >= 0 && originalY < originalCanvas.height) {
                
                const originalIndex = (originalY * originalCanvas.width + originalX) * 4;
                
                const pixelColor = {
                  r: imageData.data[originalIndex],
                  g: imageData.data[originalIndex + 1],
                  b: imageData.data[originalIndex + 2],
                  a: imageData.data[originalIndex + 3]
                };

                let isSelected = false;
                for (const selectedColor of selectedColorObjects) {
                  if (colorDistance(pixelColor, selectedColor) <= tolerance) {
                    isSelected = true;
                    break;
                  }
                }

                if (isSelected) {
                  if (desaturateResult) {
                    const desaturated = desaturateColor(imageData.data[originalIndex], imageData.data[originalIndex + 1], imageData.data[originalIndex + 2]);
                    resultData.data[resultIndex] = desaturated.r;
                    resultData.data[resultIndex + 1] = desaturated.g;
                    resultData.data[resultIndex + 2] = desaturated.b;
                    resultData.data[resultIndex + 3] = imageData.data[originalIndex + 3];
                  } else {
                    resultData.data[resultIndex] = imageData.data[originalIndex];
                    resultData.data[resultIndex + 1] = imageData.data[originalIndex + 1];
                    resultData.data[resultIndex + 2] = imageData.data[originalIndex + 2];
                    resultData.data[resultIndex + 3] = imageData.data[originalIndex + 3];
                  }
                } else {
                  resultData.data[resultIndex] = 0;
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 0;
                }
              } else {
                resultData.data[resultIndex] = 0;
                resultData.data[resultIndex + 1] = 0;
                resultData.data[resultIndex + 2] = 0;
                resultData.data[resultIndex + 3] = 0;
              }
            } else {
              resultData.data[resultIndex] = 0;
              resultData.data[resultIndex + 1] = 0;
              resultData.data[resultIndex + 2] = 0;
              resultData.data[resultIndex + 3] = 0;
            }
          }
        }

        circularCtx.putImageData(resultData, 0, 0);
        await saveAssetToStorage(circularCanvas, 'color-selection');
      } else {
        // Regular processing
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;

        const originalCtx = originalCanvas.getContext('2d');
        if (!originalCtx) return;

        const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
        const resultData = tempCtx.createImageData(imageData.width, imageData.height);

        const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
          const [r, g, b] = colorStr.split(',').map(Number);
          return { r, g, b, a: 255 };
        });

        for (let y = 0; y < imageData.height; y++) {
          for (let x = 0; x < imageData.width; x++) {
            const i = (y * imageData.width + x) * 4;
            
            const pixelColor = {
              r: imageData.data[i],
              g: imageData.data[i + 1],
              b: imageData.data[i + 2],
              a: imageData.data[i + 3]
            };

            let isSelected = false;
            for (const selectedColor of selectedColorObjects) {
              if (colorDistance(pixelColor, selectedColor) <= tolerance) {
                isSelected = true;
                break;
              }
            }

            if (isSelected) {
              if (desaturateResult) {
                const desaturated = desaturateColor(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
                resultData.data[i] = desaturated.r;
                resultData.data[i + 1] = desaturated.g;
                resultData.data[i + 2] = desaturated.b;
                resultData.data[i + 3] = imageData.data[i + 3];
              } else {
                resultData.data[i] = imageData.data[i];
                resultData.data[i + 1] = imageData.data[i + 1];
                resultData.data[i + 2] = imageData.data[i + 2];
                resultData.data[i + 3] = imageData.data[i + 3];
              }
            } else {
              resultData.data[i] = 0;
              resultData.data[i + 1] = 0;
              resultData.data[i + 2] = 0;
              resultData.data[i + 3] = 0;
            }
          }
        }

        tempCtx.putImageData(resultData, 0, 0);

        // Auto-crop to content bounds
        let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0, hasContent = false;

        for (let y = 0; y < tempCanvas.height; y++) {
          for (let x = 0; x < tempCanvas.width; x++) {
            const index = (y * tempCanvas.width + x) * 4;
            if (resultData.data[index + 3] > 0) {
              hasContent = true;
              minX = Math.min(minX, x); minY = Math.min(minY, y);
              maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            }
          }
        }

        if (hasContent) {
          const padding = 2;
          const cropX = Math.max(0, minX - padding);
          const cropY = Math.max(0, minY - padding);
          const cropWidth = Math.min(tempCanvas.width - cropX, maxX - minX + 1 + padding * 2);
          const cropHeight = Math.min(tempCanvas.height - cropY, maxY - minY + 1 + padding * 2);

          const croppedCanvas = document.createElement('canvas');
          const croppedCtx = croppedCanvas.getContext('2d');
          if (!croppedCtx) return;

          croppedCanvas.width = cropWidth;
          croppedCanvas.height = cropHeight;
          croppedCtx.putImageData(tempCtx.getImageData(cropX, cropY, cropWidth, cropHeight), 0, 0);

          await saveAssetToStorage(croppedCanvas, 'color-selection');
        }
      }
    } catch (error) {
      console.error('Error saving asset:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteAsset = (assetId: string) => {
    setSavedAssets(prev => prev.filter(asset => asset.id !== assetId));
    
    // Also remove from localStorage
    try {
      const existingAssets = JSON.parse(localStorage.getItem('colorRangeAssets') || '[]');
      const updatedAssets = existingAssets.filter((asset: any) => asset.id !== assetId);
      localStorage.setItem('colorRangeAssets', JSON.stringify(updatedAssets));
    } catch (error) {
      console.warn('Failed to update localStorage:', error);
    }
  };

  const downloadAsset = (asset: any) => {
    const a = document.createElement('a');
    a.href = asset.imageData;
    a.download = `${asset.name}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const clearAllAssets = () => {
    setSavedAssets([]);
    try {
      localStorage.removeItem('colorRangeAssets');
    } catch (error) {
      console.warn('Failed to clear localStorage:', error);
    }
  };

  // Load saved assets from localStorage on component mount
  useEffect(() => {
    try {
      const savedAssetsFromStorage = JSON.parse(localStorage.getItem('colorRangeAssets') || '[]');
      setSavedAssets(savedAssetsFromStorage);
    } catch (error) {
      console.warn('Failed to load assets from localStorage:', error);
    }
  }, []);

  const downloadResult = () => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;

    console.log('Processing download with circular crop...');
    
    console.log('Download circular mask processing:', {
      maskActive: !!activeCircularMask,
      selectedColors: selectedColors.size,
      willFilterOutput: !!activeCircularMask && selectedColors.size > 0,
      maskDetails: activeCircularMask ? `center(${Math.round(activeCircularMask.centerX)}, ${Math.round(activeCircularMask.centerY)}) radius ${Math.round(activeCircularMask.radius)}` : 'none'
    });

    const originalCanvas = originalCanvasRef.current;
    if (!originalCanvas) return;

    const originalCtx = originalCanvas.getContext('2d');
    if (!originalCtx) return;

    // If we have a circular mask, create a square canvas containing just the circle
    if (activeCircularMask) {
      const { centerX, centerY, radius } = activeCircularMask;
      
      // Calculate the square bounds that contain the circle
      const cropX = Math.max(0, Math.floor(centerX - radius));
      const cropY = Math.max(0, Math.floor(centerY - radius));
      const cropSize = Math.ceil(radius * 2);
      
      // Create output canvas sized to the circle diameter
      const circularCanvas = document.createElement('canvas');
      const circularCtx = circularCanvas.getContext('2d');
      if (!circularCtx) return;

      circularCanvas.width = cropSize;
      circularCanvas.height = cropSize;

      // Get the original image data (without any overlays) from the source image
      const originalImageToUse = croppedImage || originalImage;
      if (!originalImageToUse) return;

      // Create a clean canvas with just the original image data
      const cleanCanvas = document.createElement('canvas');
      const cleanCtx = cleanCanvas.getContext('2d');
      if (!cleanCtx) return;

      cleanCanvas.width = originalCanvas.width;
      cleanCanvas.height = originalCanvas.height;
      cleanCtx.drawImage(originalImageToUse, 0, 0, cleanCanvas.width, cleanCanvas.height);
      
      const imageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
      const resultData = circularCtx.createImageData(cropSize, cropSize);

      // Convert selected colors to ColorInfo objects
      const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
        const [r, g, b] = colorStr.split(',').map(Number);
        return { r, g, b, a: 255 };
      });

      // Calculate the circle center relative to the cropped area
      const relativeCenterX = centerX - cropX;
      const relativeCenterY = centerY - cropY;

      // Process each pixel in the cropped circular area
      for (let y = 0; y < cropSize; y++) {
        for (let x = 0; x < cropSize; x++) {
          const resultIndex = (y * cropSize + x) * 4;
          
          // Calculate distance from circle center
          const dx = x - relativeCenterX;
          const dy = y - relativeCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Check if pixel is within the circle
          if (distance <= radius) {
            // Get the original image coordinates
            const originalX = cropX + x;
            const originalY = cropY + y;
            
            // Make sure we're within the original image bounds
            if (originalX >= 0 && originalX < originalCanvas.width && 
                originalY >= 0 && originalY < originalCanvas.height) {
              
              const originalIndex = (originalY * originalCanvas.width + originalX) * 4;
              
              const pixelColor = {
                r: imageData.data[originalIndex],
                g: imageData.data[originalIndex + 1],
                b: imageData.data[originalIndex + 2],
                a: imageData.data[originalIndex + 3]
              };

              let isSelected = false;
              
              // Check if pixel color matches any selected color within tolerance
              for (const selectedColor of selectedColorObjects) {
                if (colorDistance(pixelColor, selectedColor) <= tolerance) {
                  isSelected = true;
                  break;
                }
              }

              if (isSelected) {
                // Keep the original color with full opacity (or desaturated if enabled)
                if (desaturateResult) {
                  const desaturated = desaturateColor(
                    imageData.data[originalIndex],
                    imageData.data[originalIndex + 1],
                    imageData.data[originalIndex + 2]
                  );
                  resultData.data[resultIndex] = desaturated.r;
                  resultData.data[resultIndex + 1] = desaturated.g;
                  resultData.data[resultIndex + 2] = desaturated.b;
                  resultData.data[resultIndex + 3] = 255; // Full opacity
                } else {
                  resultData.data[resultIndex] = imageData.data[originalIndex];     // R
                  resultData.data[resultIndex + 1] = imageData.data[originalIndex + 1]; // G
                  resultData.data[resultIndex + 2] = imageData.data[originalIndex + 2]; // B
                  resultData.data[resultIndex + 3] = 255; // Full opacity
                }
              } else {
                // Make transparent for unselected colors
                resultData.data[resultIndex] = 0;     // R
                resultData.data[resultIndex + 1] = 0; // G
                resultData.data[resultIndex + 2] = 0; // B
                resultData.data[resultIndex + 3] = 0; // A (transparent)
              }
            } else {
              // Outside original image bounds - make transparent
              resultData.data[resultIndex] = 0;
              resultData.data[resultIndex + 1] = 0;
              resultData.data[resultIndex + 2] = 0;
              resultData.data[resultIndex + 3] = 0;
            }
          } else {
            // Outside circle - make transparent
            resultData.data[resultIndex] = 0;
            resultData.data[resultIndex + 1] = 0;
            resultData.data[resultIndex + 2] = 0;
            resultData.data[resultIndex + 3] = 0;
          }
        }
      }

      circularCtx.putImageData(resultData, 0, 0);

      console.log('Circular crop details:', {
        originalSize: `${originalCanvas.width}x${originalCanvas.height}`,
        circleCenter: `(${Math.round(centerX)}, ${Math.round(centerY)})`,
        radius: Math.round(radius),
        outputSize: `${cropSize}x${cropSize}`,
        cropPosition: `(${cropX}, ${cropY})`
      });

      circularCanvas.toBlob((blob) => {
        if (!blob) return;
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `color-selection-circle-${cropSize}x${cropSize}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('Downloaded circular crop PNG:', {
          resolution: `${cropSize}x${cropSize}`,
          fileSize: `${(blob.size / 1024 / 1024).toFixed(2)} MB`
        });
      }, 'image/png');
      
      return;
    }

    // Fallback to regular auto-crop for non-circular selections
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    const resultData = tempCtx.createImageData(imageData.width, imageData.height);

    const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
      const [r, g, b] = colorStr.split(',').map(Number);
      return { r, g, b, a: 255 };
    });

    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const i = (y * imageData.width + x) * 4;
        
        const pixelColor = {
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
          a: imageData.data[i + 3]
        };

        let isSelected = false;
        for (const selectedColor of selectedColorObjects) {
          if (colorDistance(pixelColor, selectedColor) <= tolerance) {
            isSelected = true;
            break;
          }
        }

        if (isSelected) {
          if (desaturateResult) {
            const desaturated = desaturateColor(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
            resultData.data[i] = desaturated.r;
            resultData.data[i + 1] = desaturated.g;
            resultData.data[i + 2] = desaturated.b;
            resultData.data[i + 3] = imageData.data[i + 3];
          } else {
            resultData.data[i] = imageData.data[i];
            resultData.data[i + 1] = imageData.data[i + 1];
            resultData.data[i + 2] = imageData.data[i + 2];
            resultData.data[i + 3] = imageData.data[i + 3];
          }
        } else {
          resultData.data[i] = 0;
          resultData.data[i + 1] = 0;
          resultData.data[i + 2] = 0;
          resultData.data[i + 3] = 0;
        }
      }
    }

    tempCtx.putImageData(resultData, 0, 0);

    // Auto-crop to content bounds
    let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0, hasContent = false;

    for (let y = 0; y < tempCanvas.height; y++) {
      for (let x = 0; x < tempCanvas.width; x++) {
        const index = (y * tempCanvas.width + x) * 4;
        if (resultData.data[index + 3] > 0) {
          hasContent = true;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }

    if (!hasContent) return;

    const padding = 2;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropWidth = Math.min(tempCanvas.width - cropX, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(tempCanvas.height - cropY, maxY - minY + 1 + padding * 2);

    const croppedCanvas = document.createElement('canvas');
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) return;

    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    croppedCtx.putImageData(tempCtx.getImageData(cropX, cropY, cropWidth, cropHeight), 0, 0);

    croppedCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `color-selection-cropped-${cropWidth}x${cropHeight}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const resetSelection = () => {
    setSelectedColors(new Set());
    setBackgroundRemoved(false);
    const resultCanvas = resultCanvasRef.current;
    if (resultCanvas) {
      const ctx = resultCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      }
    }
  };

  // Background removal function
  const removeBackground = () => {
    const originalCanvas = originalCanvasRef.current;
    
    if (!originalCanvas || selectedColors.size === 0) {
      alert('Please select colors first to remove background');
      return;
    }

    setIsProcessing(true);

    try {
      const originalCtx = originalCanvas.getContext('2d');
      
      if (!originalCtx) {
        throw new Error('Could not get canvas context');
      }

      // Get the current image data from the canvas (which may already be modified)
      // This ensures we work with whatever is currently displayed
      const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
      const modifiedData = originalCtx.createImageData(imageData.width, imageData.height);

      // Convert selected colors to RGB values for comparison
      const selectedRGBColors = Array.from(selectedColors).map(colorStr => {
        const [r, g, b] = colorStr.split(',').map(Number);
        return { r, g, b, a: 255 };
      });

      // Process each pixel
      for (let i = 0; i < imageData.data.length; i += 4) {
        const currentPixel = {
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
          a: imageData.data[i + 3]
        };

        // Check if current pixel matches any selected color (within background removal threshold)
        let shouldRemove = false;
        for (const selectedColor of selectedRGBColors) {
          if (colorDistance(currentPixel, selectedColor) <= backgroundRemovalThreshold) {
            shouldRemove = true;
            break;
          }
        }

        // If pixel matches selected colors, make it transparent
        if (shouldRemove) {
          modifiedData.data[i] = 0;     // R
          modifiedData.data[i + 1] = 0; // G  
          modifiedData.data[i + 2] = 0; // B
          modifiedData.data[i + 3] = 0; // A (transparent)
        } else {
          // Keep the original pixel
          modifiedData.data[i] = imageData.data[i];       // R
          modifiedData.data[i + 1] = imageData.data[i + 1]; // G
          modifiedData.data[i + 2] = imageData.data[i + 2]; // B
          modifiedData.data[i + 3] = imageData.data[i + 3]; // A
        }
      }

      // Apply the background-removed image to the original canvas (target image)
      originalCtx.putImageData(modifiedData, 0, 0);
      
      // Mark that background has been removed
      setBackgroundRemoved(true);
      
      // Clear any existing color selections since the source image has changed
      setSelectedColors(new Set());
      
      // Clear the result canvas since we now need to reselect colors
      const resultCanvas = resultCanvasRef.current;
      if (resultCanvas) {
        const resultCtx = resultCanvas.getContext('2d');
        if (resultCtx) {
          resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
        }
      }

    } catch (error) {
      console.error('Error removing background:', error);
      alert('Failed to remove background. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Download background-removed result
  const downloadBackgroundRemoved = () => {
    const originalCanvas = originalCanvasRef.current;
    if (!originalCanvas || !backgroundRemoved) return;

    originalCanvas.toBlob((blob) => {
      if (!blob) return;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `background-removed-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  // Restore original result (undo background removal)
  const restoreOriginalResult = () => {
    setBackgroundRemoved(false);
    setSelectedColors(new Set());
    
    // Restore the current working image (could be a processing element or original image)
    if (currentProcessingElement) {
      // If we're processing a specific element, restore that element's image
      const img = new Image();
      img.onload = () => {
        drawOriginalImage(img);
        analyzeImageColors(img);
      };
      img.src = currentProcessingElement.imageData;
    } else {
      // Otherwise restore the original or cropped image
      const originalImageToUse = croppedImage || originalImage;
      if (originalImageToUse) {
        drawOriginalImage(originalImageToUse);
        analyzeImageColors(originalImageToUse);
      }
    }
    
    // Clear the result canvas
    const resultCanvas = resultCanvasRef.current;
    if (resultCanvas) {
      const ctx = resultCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      }
    }
  };

  const toggleColorSelection = (colorString: string) => {
    setSelectedColors(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(colorString)) {
        newSelected.delete(colorString);
      } else {
        newSelected.add(colorString);
      }
      
      // Reset background removed state when colors change
      setBackgroundRemoved(false);
      
      // Immediately process with the current circular mask
      setTimeout(() => {
        if (newSelected.size > 0) {
          processImage(activeCircularMask || undefined);
        }
      }, 0);
      
      return newSelected;
    });
  };

  const selectAllColors = () => {
    const allColors = new Set(detectedColors.map(c => c.color));
    setSelectedColors(allColors);
    setBackgroundRemoved(false);
    
    // Immediately process with the current circular mask
    if (allColors.size > 0) {
      setTimeout(() => processImage(activeCircularMask || undefined), 0);
    }
  };

  const deselectAllColors = () => {
    setSelectedColors(new Set());
    setBackgroundRemoved(false);
  };

  // Auto-process when selection or tolerance changes
  useEffect(() => {
    if (selectedColors.size > 0 && !backgroundRemoved) {
      processImage(activeCircularMask || undefined);
    }
  }, [selectedColors, tolerance, processImage, activeCircularMask, backgroundRemoved]);

  // Debounced effect for circular mask analysis
  useEffect(() => {
    if (activeCircularMask && originalImage) {
      const timeoutId = setTimeout(() => {
        const imageToUse = croppedImage || originalImage;
        analyzeImageColors(imageToUse, activeCircularMask);
        
        // Also trigger processing if colors are already selected
        if (selectedColors.size > 0) {
          processImage(activeCircularMask);
        }
      }, 300); // 300ms delay to prevent too frequent analysis
      
      return () => clearTimeout(timeoutId);
    }
  }, [activeCircularMask, originalImage, croppedImage, selectedColors.size, processImage]);

  // Redraw image when canvas ref becomes available
  useEffect(() => {
    if (originalImage && originalCanvasRef.current) {
      const imageToUse = croppedImage || originalImage;
      drawOriginalImage(imageToUse);
      // Only analyze colors if we don't have any detected colors yet, or if we have a new image
      if (!detectedColors.length || !croppedImage) {
        analyzeImageColors(imageToUse, activeCircularMask || undefined);
      }
    }
  }, [originalImage, croppedImage]);

  // Draw crop overlay when crop area changes
  useEffect(() => {
    if (isCropMode && cropArea) {
      drawCropOverlay();
    }
  }, [cropArea, isCropMode]);

  // Handle keyboard events for moving and resizing crop area
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Only handle keys when in crop mode and we have a crop area
      if (!isCropMode || !cropArea) return;
      
      const canvas = originalCanvasRef.current;
      if (!canvas) return;
      
      // Prevent default behavior for handled keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'BracketLeft', 'BracketRight'].includes(event.code)) {
        event.preventDefault();
        
        const moveDistance = event.shiftKey ? 5 : 1; // Hold Shift for faster movement/resizing
        
        // Movement with arrow keys (when not holding Ctrl)
        if (!event.ctrlKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
          let newX = cropArea.x;
          let newY = cropArea.y;
          
          switch (event.code) {
            case 'ArrowUp':
              newY = Math.max(0, cropArea.y - moveDistance);
              break;
            case 'ArrowDown':
              newY = Math.min(canvas.height - cropArea.height, cropArea.y + moveDistance);
              break;
            case 'ArrowLeft':
              newX = Math.max(0, cropArea.x - moveDistance);
              break;
            case 'ArrowRight':
              newX = Math.min(canvas.width - cropArea.width, cropArea.x + moveDistance);
              break;
          }
          
          setCropArea({
            ...cropArea,
            x: newX,
            y: newY
          });
        }
        
        // Resizing with Ctrl + arrow keys, or +/- keys, or [ ] keys
        if ((event.ctrlKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) ||
            ['Equal', 'Minus', 'BracketLeft', 'BracketRight'].includes(event.code)) {
          
          const resizeAmount = event.shiftKey ? 10 : 2; // Bigger steps with Shift
          let newWidth = cropArea.width;
          let newHeight = cropArea.height;
          let newX = cropArea.x;
          let newY = cropArea.y;
          
          if (cropMode === 'circle') {
            // For circles, resize uniformly
            const isExpand = event.code === 'ArrowDown' || event.code === 'ArrowRight' || 
                             event.code === 'Equal' || event.code === 'BracketRight';
            const change = isExpand ? resizeAmount * 2 : -resizeAmount * 2; // Diameter change
            
            newWidth = Math.max(20, Math.min(canvas.width, cropArea.width + change));
            newHeight = newWidth; // Keep it circular
            
            // Adjust position to keep circle centered
            const widthDiff = newWidth - cropArea.width;
            newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - widthDiff / 2));
            newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - widthDiff / 2));
            
          } else {
            // For rectangles, resize based on specific direction or uniform
            if (event.code === 'Equal' || event.code === 'BracketRight') {
              // Expand uniformly
              newWidth = Math.max(20, Math.min(canvas.width, cropArea.width + resizeAmount * 2));
              newHeight = Math.max(20, Math.min(canvas.height, cropArea.height + resizeAmount * 2));
              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - resizeAmount));
              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - resizeAmount));
            } else if (event.code === 'Minus' || event.code === 'BracketLeft') {
              // Contract uniformly
              newWidth = Math.max(20, cropArea.width - resizeAmount * 2);
              newHeight = Math.max(20, cropArea.height - resizeAmount * 2);
              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x + resizeAmount));
              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y + resizeAmount));
            } else {
              // Directional resizing with Ctrl + arrows
              switch (event.code) {
                case 'ArrowUp':
                  newHeight = Math.max(20, cropArea.height - resizeAmount);
                  newY = Math.min(canvas.height - newHeight, cropArea.y + resizeAmount);
                  break;
                case 'ArrowDown':
                  newHeight = Math.max(20, Math.min(canvas.height - cropArea.y, cropArea.height + resizeAmount));
                  break;
                case 'ArrowLeft':
                  newWidth = Math.max(20, cropArea.width - resizeAmount);
                  newX = Math.min(canvas.width - newWidth, cropArea.x + resizeAmount);
                  break;
                case 'ArrowRight':
                  newWidth = Math.max(20, Math.min(canvas.width - cropArea.x, cropArea.width + resizeAmount));
                  break;
              }
            }
          }
          
          setCropArea({
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
          });
        }
      }
    };
    
    // Add event listener when in crop mode
    if (isCropMode && cropArea) {
      window.addEventListener('keydown', handleKeyPress);
      return () => {
        window.removeEventListener('keydown', handleKeyPress);
      };
    }
  }, [isCropMode, cropMode, cropArea]);

  // Detect circles when switching to circle mode on an already cropped image - REMOVED
  // Using manual circle positioning instead

  return (
    <div className={`relative w-full max-w-6xl mx-auto p-4 ${className || ''} ${isDarkMode ? 'dark' : ''}`}>
      {/* Main Content Area */}
      <Card className={isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white'}>
        <CardHeader className={isDarkMode ? 'text-white' : ''}>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Color Range Selection Tool
            </CardTitle>
            <Button
              onClick={() => setIsDarkMode(!isDarkMode)}
              variant="outline"
              size="sm"
              className={`flex items-center gap-2 ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {isDarkMode ? 'Light' : 'Dark'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={`space-y-6 ${isDarkMode ? 'text-white' : ''}`}>
          {/* Step 1: Image Input (only show if no image loaded) */}
          {currentStep === 'input' && (
            <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span>
                Upload Image
              </h3>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Choose Image
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                
                <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  Or paste an image from clipboard, or enter an image URL
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Element Detection (show when image is loaded) */}
          {currentStep === 'detection' && originalImage && (
            <div className="space-y-4">
              <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <span className="bg-green-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">2</span>
                  Interactive Element Detection
                </h3>
                <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  Hover over different parts of the image to detect and select elements for processing.
                </p>
                
                {/* Source Image */}
                <div className="space-y-2">
                  <h4 className="font-medium">Source Image</h4>
                  <div className={`border-2 rounded-lg p-4 ${
                    isDarkMode 
                      ? 'border-gray-600 bg-gray-800' 
                      : 'border-gray-300 bg-white'
                  }`}>
                    <canvas
                      ref={originalCanvasRef}
                      onClick={handleCanvasClick}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      className={`border border-gray-200 rounded shadow-sm ${
                        isCropMode ? 'cursor-crosshair' : 'cursor-pointer'
                      }`}
                      style={{ 
                        maxWidth: '100%',
                        height: 'auto',
                        display: 'block',
                        imageRendering: 'auto'
                      }}
                    />
                  </div>
                </div>

                {/* Interactive Element Detection */}
                {showInteractiveDetection && (
                  <div className="mt-4">
                    <InteractiveElementDetector
                      imageSrc={interactiveImageSrc}
                      onCropRegion={handleMLCropRegion}
                      onShowPreview={(imageData, element) => {
                        handleShowPreview(imageData, element);
                        addElementToProcessingList({ imageData, ...element });
                      }}
                      selectedColors={selectedColors}
                      isVisible={showInteractiveDetection}
                    />
                  </div>
                )}

                {/* Selected Elements List */}
                {selectedElements.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-medium mb-2">Selected Elements ({selectedElements.length})</h4>
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {selectedElements.map((element) => {
                        // Calculate aspect ratio of the element's bounding box
                        const elementWidth = element.boundingBox?.width || 1;
                        const elementHeight = element.boundingBox?.height || 1;
                        const aspectRatio = elementWidth / elementHeight;
                        
                        // Use 9/16 (portrait) for tall elements, square for wide/square elements
                        const usePortraitRatio = aspectRatio < 1.2; // If element is taller or nearly square
                        const aspectRatioClass = usePortraitRatio ? 'aspect-[4/5]' : 'aspect-square';
                        
                        return (
                          <div key={element.id} className={`border rounded-md p-1.5 ${isDarkMode ? 'border-gray-600 bg-gray-700' : 'border-gray-300 bg-gray-50'}`}>
                            <div className={`w-full ${aspectRatioClass} rounded mb-1.5 overflow-hidden bg-gray-100 ${isDarkMode ? 'bg-gray-600' : ''}`}>
                              <img 
                                src={element.imageData} 
                                alt={`Element ${element.elementType}`}
                                className="w-full h-full object-contain"
                              />
                            </div>
                            <div className="text-[10px]">
                              <div className="font-medium truncate">{element.elementType}</div>
                              <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} truncate`}>
                                {(element.confidence * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div className="flex gap-1 mt-1.5">
                              <Button
                                onClick={() => processSelectedElement(element)}
                                variant="default"
                                size="sm"
                                className="flex-1 text-[10px] h-6 px-1"
                              >
                                Process
                              </Button>
                              <Button
                                onClick={() => removeElementFromProcessingList(element.id)}
                                variant="outline"
                                size="sm"
                                className="text-[10px] h-6 w-6 p-0"
                              >
                                <X className="w-2.5 h-2.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} flex-1`}>
                    {selectedElements.length > 0 
                      ? `${selectedElements.length} elements ready. Click "Process" on any element to work with it individually.`
                      : 'Hover over the image to detect elements and add them to your processing list.'
                    }
                  </div>
                  <Button
                    onClick={() => setCurrentStep('input')}
                    variant="outline"
                  >
                    Upload Different Image
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Color Processing (show when processing starts) */}
          {currentStep === 'processing' && originalImage && (
            <div className="space-y-4">
              <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <span className="bg-purple-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">3</span>
                  Color Processing & Results
                  {currentProcessingElement && (
                    <span className={`text-sm font-normal ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      - Processing: {currentProcessingElement.elementType}
                    </span>
                  )}
                </h3>
                <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  Click on colors in the image to select them. Use the color palette and tolerance controls to fine-tune your selection.
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Source Image */}
                  <div className="space-y-2">
                    <h4 className="font-medium">
                      {currentProcessingElement ? 
                        `${currentProcessingElement.elementType} (Click to select colors)` : 
                        'Source Element (Click to select colors)'
                      }
                    </h4>
                    <div className={`border-2 rounded-lg p-4 ${
                      isDarkMode 
                        ? 'border-gray-600 bg-gray-800' 
                        : 'border-gray-300 bg-white'
                    }`}>
                      <canvas
                        ref={originalCanvasRef}
                        onClick={handleCanvasClick}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        className={`border border-gray-200 rounded shadow-sm ${
                          isCropMode ? 'cursor-crosshair' : 'cursor-pointer'
                        }`}
                        style={{ 
                          maxWidth: '100%',
                          height: 'auto',
                          display: 'block',
                          imageRendering: 'auto'
                        }}
                      />
                    </div>
                  </div>

                  {/* Result Preview */}
                  <div className="space-y-2">
                    <h4 className="font-medium">Result Preview</h4>
                    <div className={`border-2 rounded-lg p-4 min-h-[300px] flex items-center justify-center ${
                      isDarkMode 
                        ? 'border-gray-600' 
                        : 'border-gray-300'
                    } ${
                      showRedBackground 
                        ? 'bg-red-500' 
                        : 'bg-white bg-opacity-50 bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%),linear-gradient(-45deg,#f0f0f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f0f0f0_75%),linear-gradient(-45deg,transparent_75%,#f0f0f0_75%)] bg-[length:20px_20px] bg-[0_0,0_10px,10px_-10px,-10px_0px]'
                    }`}>
                      {selectedColors.size > 0 ? (
                        <div className="relative">
                          <canvas
                            ref={resultCanvasRef}
                            className="border border-gray-200 rounded shadow-sm"
                            style={{ 
                              maxWidth: '100%',
                              height: 'auto',
                              display: 'block',
                              imageRendering: 'auto'
                            }}
                          />
                          {isProcessing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75 rounded">
                              <div className={`text-sm ${isDarkMode ? 'text-gray-800' : 'text-gray-900'}`}>Processing...</div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={`text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          <Palette className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p>Result will appear here</p>
                          <p className="text-sm">Select colors to see the preview</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    onClick={returnToElementSelection}
                    variant="outline"
                  >
                    ← Back to Element Selection
                  </Button>
                  {currentProcessingElement && (
                    <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} flex items-center`}>
                      Processing: {currentProcessingElement.elementType} 
                      ({(currentProcessingElement.confidence * 100).toFixed(1)}% confidence)
                    </div>
                  )}
                  <Button
                    onClick={() => setCurrentStep('input')}
                    variant="outline"
                  >
                    Upload New Image
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* No Image State */}
          {!originalImage && currentStep === 'input' && (
            <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">Get Started</h3>
              <p className="mb-1">Upload an image to begin the element detection workflow</p>
              <p className="text-sm">1. Upload image → 2. Select elements → 3. Process colors</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cropped Results List */}
      <CroppedResultsList
        results={croppedResults}
        onDeleteResult={deleteCroppedResult}
        onDownloadResult={downloadCroppedResult}
        onPreviewResult={previewCroppedResult}
        isDarkMode={isDarkMode}
      />

      {/* Floating Color Palette Toolbar - only show in processing step */}
      {originalImage && detectedColors.length > 0 && currentStep === 'processing' && (
        <div className={`fixed top-4 right-4 w-64 z-50 ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'} border rounded-lg shadow-lg`}>
          <div className={`p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <h4 className={`font-semibold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Color Palette</h4>
              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{detectedColors.length} colors</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Tolerance:</label>
              <input
                type="range"
                min="0"
                max="100"
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="flex-1 h-1"
              />
              <span className={`text-xs w-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{tolerance}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>BG Removal:</label>
              <input
                type="range"
                min="0"
                max="100"
                value={backgroundRemovalThreshold}
                onChange={(e) => setBackgroundRemovalThreshold(Number(e.target.value))}
                className="flex-1 h-1"
              />
              <span className={`text-xs w-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{backgroundRemovalThreshold}</span>
            </div>
          </div>
          
          <div className="p-2">
            <div className="flex gap-1 mb-2">
              <Button
                onClick={selectAllColors}
                variant="outline"
                size="sm"
                className={`text-xs flex-1 ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
              >
                All
              </Button>
              <Button
                onClick={deselectAllColors}
                variant="outline"
                size="sm"
                className={`text-xs flex-1 ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
              >
                Clear
              </Button>
            </div>
            
            <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto pr-1">
              {detectedColors.map((colorData, index) => {
                const isSelected = selectedColors.has(colorData.color);
                const [r, g, b] = colorData.color.split(',').map(Number);
                
                return (
                  <button
                    key={index}
                    onClick={() => toggleColorSelection(colorData.color)}
                    className={`
                      relative w-6 h-6 rounded border transition-all duration-200 hover:scale-110
                      ${isSelected 
                        ? 'border-blue-500 ring-1 ring-blue-300' 
                        : 'border-gray-400 dark:border-gray-600'
                      }
                    `}
                    style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                    title={`RGB(${r}, ${g}, ${b}) - ${colorData.count} pixels`}
                  >
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full border border-gray-400"></div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            
            {selectedColors.size > 0 && (
              <div className={`mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {selectedColors.size} of {detectedColors.length} selected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Tools Toolbar - only show crop tools independently */}
      {originalImage && (currentStep === 'processing' || currentStep === 'detection') && (
        <div className={`fixed top-4 left-4 w-72 z-50 ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'} border rounded-lg shadow-lg`}>
          <div className={`p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <h4 className={`font-semibold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {currentStep === 'processing' ? 'Processing Tools' : 'Independent Crop Tools'}
            </h4>
          </div>
          
          <div className="p-3 space-y-3">
            {/* Crop Tools */}
            <div className="space-y-2">
              <h5 className={`text-xs font-medium uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Crop</h5>
              <div className="flex gap-2">
                <Button
                  onClick={() => setIsCropMode(!isCropMode)}
                  variant={isCropMode ? "default" : "outline"}
                  size="sm"
                  className={`flex items-center gap-1 text-xs ${!isCropMode && isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : !isCropMode ? 'border-gray-300 text-gray-900 hover:bg-gray-50' : ''}`}
                >
                  <Crop className="w-3 h-3" />
                  {isCropMode ? 'Exit' : 'Crop'}
                </Button>
                
                {isCropMode && (
                  <div className="flex gap-1 border rounded p-1">
                    <Button
                      onClick={() => setCropMode('rectangle')}
                      variant={cropMode === 'rectangle' ? "default" : "ghost"}
                      size="sm"
                      className={`h-6 px-2 text-xs ${cropMode !== 'rectangle' && isDarkMode ? 'text-white hover:bg-gray-800' : cropMode !== 'rectangle' ? 'text-gray-900 hover:bg-gray-100' : ''}`}
                    >
                      □
                    </Button>
                    <Button
                      onClick={() => setCropMode('circle')}
                      variant={cropMode === 'circle' ? "default" : "ghost"}
                      size="sm"
                      className={`h-6 px-2 text-xs ${cropMode !== 'circle' && isDarkMode ? 'text-white hover:bg-gray-800' : cropMode !== 'circle' ? 'text-gray-900 hover:bg-gray-100' : ''}`}
                    >
                      ○
                    </Button>
                  </div>
                )}
                
                {croppedImage && (
                  <Button
                    onClick={() => {
                      setCroppedImage(null);
                      setIsCropMode(false);
                      setCropArea(null);
                      setActiveCircularMask(null);
                      setSelectedColors(new Set());
                      setDetectedColors([]);
                      if (originalImage) {
                        setTimeout(() => {
                          drawOriginalImage(originalImage);
                          analyzeImageColors(originalImage);
                        }, 0);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className={`flex items-center gap-1 text-xs ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </Button>
                )}
              </div>
              
              {cropArea && (
                <div className="space-y-2">
                  <Button
                    onClick={applyCrop}
                    size="sm"
                    className="w-full text-xs flex items-center gap-1"
                  >
                    <ZoomIn className="w-3 h-3" />
                    Apply Crop
                  </Button>
                  
                  <div className="flex gap-1">
                    <Button
                      onClick={() => {
                        if (!cropArea) return;
                        const canvas = originalCanvasRef.current;
                        if (!canvas) return;
                        
                        const resizeAmount = 10;
                        let newWidth, newHeight, newX, newY;
                        
                        if (cropMode === 'circle') {
                          newWidth = Math.max(20, cropArea.width - resizeAmount * 2);
                          newHeight = newWidth;
                          const widthDiff = newWidth - cropArea.width;
                          newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - widthDiff / 2));
                          newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - widthDiff / 2));
                        } else {
                          newWidth = Math.max(20, cropArea.width - resizeAmount * 2);
                          newHeight = Math.max(20, cropArea.height - resizeAmount * 2);
                          newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x + resizeAmount));
                          newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y + resizeAmount));
                        }
                        
                        setCropArea({ x: newX, y: newY, width: newWidth, height: newHeight });
                      }}
                      variant="outline"
                      size="sm"
                      className={`flex-1 text-xs ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
                    >
                      −
                    </Button>
                    <Button
                      onClick={() => {
                        if (!cropArea) return;
                        const canvas = originalCanvasRef.current;
                        if (!canvas) return;
                        
                        const resizeAmount = 10;
                        let newWidth, newHeight, newX, newY;
                        
                        if (cropMode === 'circle') {
                          newWidth = Math.min(canvas.width, cropArea.width + resizeAmount * 2);
                          newHeight = newWidth;
                          const widthDiff = newWidth - cropArea.width;
                          newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - widthDiff / 2));
                          newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - widthDiff / 2));
                        } else {
                          newWidth = Math.min(canvas.width, cropArea.width + resizeAmount * 2);
                          newHeight = Math.min(canvas.height, cropArea.height + resizeAmount * 2);
                          newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - resizeAmount));
                          newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - resizeAmount));
                        }
                        
                        setCropArea({ x: newX, y: newY, width: newWidth, height: newHeight });
                      }}
                      variant="outline"
                      size="sm"
                      className={`flex-1 text-xs ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
                    >
                      +
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Output Options - only show in processing step */}
            {selectedColors.size > 0 && currentStep === 'processing' && (
              <div className="space-y-2">
                <h5 className={`text-xs font-medium uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Output</h5>
                
                <div className="space-y-2">
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <input
                      type="checkbox"
                      checked={showRedBackground}
                      onChange={(e) => setShowRedBackground(e.target.checked)}
                      className="rounded"
                    />
                    <Eye className="w-3 h-3" />
                    Red background (preview)
                  </label>
                  
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    <input
                      type="checkbox"
                      checked={desaturateResult}
                      onChange={(e) => setDesaturateResult(e.target.checked)}
                      className="rounded"
                    />
                    <Palette className="w-3 h-3" />
                    Convert to grayscale
                  </label>
                </div>
                
                <Button
                  onClick={saveAsset}
                  disabled={isProcessing}
                  className="w-full text-xs flex items-center gap-1"
                  size="sm"
                >
                  <Download className="w-3 h-3" />
                  Save Asset
                </Button>
                
                <Button
                  onClick={removeBackground}
                  disabled={isProcessing || selectedColors.size === 0 || backgroundRemoved}
                  variant="secondary"
                  className="w-full text-xs flex items-center gap-1"
                  size="sm"
                >
                  <Eraser className="w-3 h-3" />
                  Remove Background
                </Button>
                
                {backgroundRemoved && (
                  <>
                    <Button
                      onClick={downloadBackgroundRemoved}
                      disabled={isProcessing}
                      variant="outline"
                      className="w-full text-xs flex items-center gap-1"
                      size="sm"
                    >
                      <Download className="w-3 h-3" />
                      Download Background Removed
                    </Button>
                    
                    <Button
                      onClick={restoreOriginalResult}
                      disabled={isProcessing}
                      variant="ghost"
                      className="w-full text-xs flex items-center gap-1"
                      size="sm"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Restore Original
                    </Button>
                  </>
                )}
                
                <Button
                  onClick={resetSelection}
                  variant="outline"
                  size="sm"
                  className={`w-full text-xs flex items-center gap-1 ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Selection
                </Button>

                {savedAssets.length > 0 && (
                  <Button
                    onClick={() => setShowAssetsPanel(!showAssetsPanel)}
                    variant="outline"
                    size="sm"
                    className={`w-full text-xs flex items-center gap-1 ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-800' : 'border-gray-300 text-gray-900 hover:bg-gray-50'}`}
                  >
                    <Download className="w-3 h-3" />
                    View Assets ({savedAssets.length})
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Assets Panel */}
      {savedAssets.length > 0 && (
        <div className={`fixed bottom-4 right-4 z-50`}>
          <Button
            onClick={() => setShowAssetsPanel(!showAssetsPanel)}
            className={`mb-2 flex items-center gap-2 ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700' : 'bg-white border-gray-300 text-gray-900 hover:bg-gray-50'} border shadow-lg`}
            variant="outline"
            size="sm"
          >
            <Download className="w-4 h-4" />
            Assets ({savedAssets.length})
          </Button>
        </div>
      )}

      {showAssetsPanel && (
        <div className={`fixed bottom-16 right-4 w-80 max-h-96 z-50 ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'} border rounded-lg shadow-lg overflow-hidden`}>
          <div className={`p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <h4 className={`font-semibold text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Saved Assets</h4>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{savedAssets.length} items</span>
                <Button
                  onClick={clearAllAssets}
                  variant="ghost"
                  size="sm"
                  className={`h-6 px-2 text-xs ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                >
                  Clear All
                </Button>
                <Button
                  onClick={() => setShowAssetsPanel(false)}
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
          
          <div className="p-2 max-h-80 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              {savedAssets.map((asset) => (
                <div key={asset.id} className={`border rounded-lg p-2 ${isDarkMode ? 'border-gray-600 bg-gray-800' : 'border-gray-300 bg-gray-50'}`}>
                  <div className="aspect-square rounded mb-2 overflow-hidden bg-gray-100 dark:bg-gray-600">
                    <img 
                      src={asset.imageData} 
                      alt={asset.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="text-[10px] space-y-1">
                    <div className="font-medium truncate" title={asset.name}>
                      {asset.name}
                    </div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} truncate`}>
                      {asset.type.replace('-', ' ')}
                    </div>
                    {asset.metadata?.dimensions && (
                      <div className={`${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        {asset.metadata.dimensions.width}×{asset.metadata.dimensions.height}
                      </div>
                    )}
                    <div className={`${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      {new Date(asset.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-1 mt-2">
                    <Button
                      onClick={() => downloadAsset(asset)}
                      variant="outline"
                      size="sm"
                      className="flex-1 text-[10px] h-6 px-1"
                      title="Download Asset"
                    >
                      <Download className="w-2.5 h-2.5" />
                    </Button>
                    <Button
                      onClick={() => deleteAsset(asset.id)}
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-6 w-6 p-0"
                      title="Delete Asset"
                    >
                      <X className="w-2.5 h-2.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

ColorRangeSelector.displayName = 'ColorRangeSelector';

export default ColorRangeSelector;
