import { useState } from "react";
import DiscountCard from "./DiscoutnCard";
import { Button } from "@/components/ui/button";

interface Discount {
  discountCode: string;
  status: "active" | "inactive";
}

// Sample discount data
const discountData: Discount[] = [
  { discountCode: "SAVE20", status: "active" },
  { discountCode: "FREESHIP", status: "inactive" },
  { discountCode: "WELCOME", status: "active" },
  { discountCode: "HOLIDAY", status: "inactive" },
];

export function DiscountCardList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  // Keep track of which discount codes are currently selected
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  // Filter the discount data based on search term and filter
  const filteredDiscounts = discountData.filter((discount) => {
    const matchesSearch = discount.discountCode
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesFilter = filter === "all" ? true : discount.status === filter;
    return matchesSearch && matchesFilter;
  });

  // Toggle selection for a given discount code
  const toggleSelect = (discountCode: string) => {
    setSelectedCards((prev) =>
      prev.includes(discountCode)
        ? prev.filter((code) => code !== discountCode)
        : [...prev, discountCode]
    );
  };

  // Update the filter WITHOUT clearing selectedCards
  // so that checked items remain selected if they still appear in the new filter.
  const handleFilterChange = (newFilter: "all" | "active" | "inactive") => {
    setFilter(newFilter);
    // We do NOT reset selectedCards here.
  };

  return (
    <div className="p-4">
      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search discount codes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="rounded-md p-2 border border-gray-300 dark:bg-neutral-900 dark:border-gray-600 w-full"
        />
      </div>

      {/* Filter Buttons */}
      <div className="mb-4 flex gap-2">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => handleFilterChange("all")}
        >
          All
        </Button>
        <Button
          variant={filter === "active" ? "default" : "outline"}
          onClick={() => handleFilterChange("active")}
        >
          Active
        </Button>
        <Button
          variant={filter === "inactive" ? "default" : "outline"}
          onClick={() => handleFilterChange("inactive")}
        >
          Inactive
        </Button>
      </div>

      {/* Discount Cards */}
      <div className="space-y-4">
        {filteredDiscounts.map((discount) => (
          <DiscountCard
            key={discount.discountCode}
            discountCode={discount.discountCode}
            status={discount.status}
            // Pass down whether this discount code is selected
            isSelected={selectedCards.includes(discount.discountCode)}
            // Pass down how to toggle its selection
            onToggleSelect={() => toggleSelect(discount.discountCode)}
          />
        ))}
      </div>
    </div>
  );
}

export default DiscountCardList;
