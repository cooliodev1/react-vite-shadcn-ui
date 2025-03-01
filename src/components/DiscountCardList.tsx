import { useState } from "react";
import DiscountCard from "./DiscoutnCard";
import { Button } from "@/components/ui/button";

interface Discount {
  discountCode: string;
  status: "active" | "inactive";
}

// Sample data
const discountData: Discount[] = [
  { discountCode: "SAVE20", status: "active" },
  { discountCode: "FREESHIP", status: "inactive" },
  { discountCode: "WELCOME", status: "active" },
  { discountCode: "HOLIDAY", status: "inactive" },
];

export function DiscountCardList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const filteredDiscounts = discountData.filter((discount) => {
    const matchesSearch = discount.discountCode
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesFilter = filter === "all" ? true : discount.status === filter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="p-4">
      {/* Search Bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search discount codes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="rounded-md p-2 border border-gray-300 dark:bg-neutral-800 dark:border-gray-600 w-full"
        />
      </div>

      {/* Filter Buttons */}
      <div className="mb-4 flex gap-2">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          All
        </Button>
        <Button
          variant={filter === "active" ? "default" : "outline"}
          onClick={() => setFilter("active")}
        >
          Active
        </Button>
        <Button
          variant={filter === "inactive" ? "default" : "outline"}
          onClick={() => setFilter("inactive")}
        >
          Inactive
        </Button>
      </div>

      {/* List of Discount Cards */}
      <div className="space-y-4">
        {filteredDiscounts.map((discount) => (
          <DiscountCard
            key={discount.discountCode}
            discountCode={discount.discountCode}
            status={discount.status}
          />
        ))}
      </div>
    </div>
  );
}

export default DiscountCardList;
