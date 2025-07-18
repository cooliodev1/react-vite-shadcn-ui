import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, Trash2, Eye, Palette } from 'lucide-react';

interface CroppedResult {
  id: string;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
    elementType: 'logo' | 'text' | 'button' | 'graphic' | 'shape' | 'unknown';
  };
  imageData: string;
  selectedColors: Set<string>;
  timestamp: number;
}

interface CroppedResultsListProps {
  results: CroppedResult[];
  onDeleteResult?: (id: string) => void;
  onDownloadResult?: (result: CroppedResult) => void;
  onPreviewResult?: (result: CroppedResult) => void;
  isDarkMode?: boolean;
}

const CroppedResultsList: React.FC<CroppedResultsListProps> = ({
  results,
  onDeleteResult,
  onDownloadResult,
  onPreviewResult,
  isDarkMode = false
}) => {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getElementIcon = (elementType: string) => {
    switch (elementType) {
      case 'logo':
        return '🏷️';
      case 'text':
        return '📝';
      case 'button':
        return '🔘';
      case 'graphic':
        return '🎨';
      case 'shape':
        return '🔷';
      default:
        return '❓';
    }
  };

  const getElementColor = (elementType: string) => {
    switch (elementType) {
      case 'logo':
        return 'bg-purple-500';
      case 'text':
        return 'bg-blue-500';
      case 'button':
        return 'bg-green-500';
      case 'graphic':
        return 'bg-orange-500';
      case 'shape':
        return 'bg-pink-500';
      default:
        return 'bg-gray-500';
    }
  };

  const downloadImage = (result: CroppedResult) => {
    const link = document.createElement('a');
    link.download = `cropped_${result.region.elementType}_${result.timestamp}.png`;
    link.href = result.imageData;
    link.click();
  };

  if (results.length === 0) {
    return (
      <Card className={isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}>
        <CardContent className="pt-6">
          <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            <Palette className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No Cropped Results Yet</h3>
            <p className="text-sm">
              Hover over image elements and click the crop button to create results
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          <Palette className="w-5 h-5" />
          Cropped Results ({results.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 max-h-96 overflow-y-auto">
        {results.map((result) => (
          <div
            key={result.id}
            className={`border rounded-lg p-4 ${
              isDarkMode ? 'border-gray-600 bg-gray-800' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Preview Image */}
              <div className="flex-shrink-0">
                <img
                  src={result.imageData}
                  alt={`Cropped ${result.region.elementType}`}
                  className="w-16 h-16 object-cover rounded border border-gray-300 dark:border-gray-600"
                />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{getElementIcon(result.region.elementType)}</span>
                  <Badge className={`text-white ${getElementColor(result.region.elementType)}`}>
                    {result.region.elementType}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {Math.round(result.region.confidence * 100)}%
                  </Badge>
                </div>

                <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div>Size: {result.region.width}×{result.region.height}px</div>
                  <div>Colors: {result.selectedColors.size} selected</div>
                  <div>Created: {formatTimestamp(result.timestamp)}</div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPreviewResult?.(result)}
                  className="h-8 px-2"
                >
                  <Eye className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onDownloadResult?.(result);
                    downloadImage(result);
                  }}
                  className="h-8 px-2"
                >
                  <Download className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDeleteResult?.(result.id)}
                  className="h-8 px-2 text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default CroppedResultsList;
