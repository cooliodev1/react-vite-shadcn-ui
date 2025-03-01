import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { RiCheckboxCircleLine, RiCheckboxBlankCircleFill } from "react-icons/ri";

interface DiscountCardProps {
  discountCode: string;
  status: "active" | "inactive";
}

export function DiscountCard({ discountCode, status }: DiscountCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSelected, setIsSelected] = useState(false);

  // Use "default" for active (with custom green styling) and "destructive" for inactive.
  const badgeVariant = status === "active" ? "default" : "destructive";

  return (
    <Card
      onClick={() => setIsSelected(!isSelected)}
      className={`mb-4 transition-colors duration-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 cursor-pointer ${
        isSelected ? "border border-black dark:border-white" : ""
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between p-4">
        {/* Left side: Discount code with checkbox icon */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6">
            {isSelected ? (
              <RiCheckboxCircleLine className="w-6 h-6 text-green-300" />
            ) : (
              <RiCheckboxBlankCircleFill className="w-6 h-6 text-gray-400" />
            )}
          </div>
          <h3 className="text-xl font-bold">{discountCode}</h3>
        </div>

        {/* Right side: Badge and expand/collapse button */}
        <div className="flex items-center gap-2">
          <Badge
            variant={badgeVariant}
            className={status === "active" ? "bg-green-300 text-black" : ""}
          >
            {status.toUpperCase()}
          </Badge>
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation(); // Prevent toggling the checkbox when clicking this button
              setIsExpanded(!isExpanded);
            }}
            className="
              bg-neutral-200
              dark:bg-neutral-700 
              text-gray-800 
              dark:text-gray-200 
              hover:bg-gray-100 
              dark:hover:bg-neutral-700 
              transition-colors 
              duration-200
              rounded-md 
              p-3
            "
          >
            {isExpanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </div>

      {/* Expandable content */}
      {isExpanded && (
        <CardContent>
          <p className="mb-2">Discount Code Details:</p>
          {/* Additional details can be added here */}
        </CardContent>
      )}
    </Card>
  );
}

export default DiscountCard;
