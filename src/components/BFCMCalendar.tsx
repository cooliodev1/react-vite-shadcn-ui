import * as React from "react"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { events } from "@/data/events"

/**
 * Highlight event days in the calendar and show a sidebar with the
 * coresponding events when a date is selected.
 */
export function BFCMCalendar() {
  const [selectedDay, setSelectedDay] = React.useState<Date | undefined>()
  const [month, setMonth] = React.useState<Date>(
    // Default to November 2025
    new Date("2025-11-01")
  )

  // Build modifiers for react‑day‑picker
  const eventDates = React.useMemo(() => events.map(e => new Date(e.date)), [])
  const modifiers = React.useMemo(() => ({
    event: eventDates
  }), [eventDates])

  const modifiersClassNames = {
    event: "bg-blue-600 text-white hover:bg-blue-600 focus:outline-none"
  }

  // Get events for the selected date
  const selectedEvents = React.useMemo(() => {
    if (!selectedDay) return [] as typeof events
    return events.filter(e => {
      const d1 = new Date(e.date)
      return (
        d1.getFullYear() === selectedDay.getFullYear() &&
        d1.getMonth() === selectedDay.getMonth() &&
        d1.getDate() === selectedDay.getDate()
      )
    })
  }, [selectedDay])

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <Calendar
        mode="single"
        month={month}
        onMonthChange={setMonth}
        selected={selectedDay}
        onSelect={setSelectedDay}
        modifiers={modifiers}
        modifiersClassNames={modifiersClassNames}
        className="rounded-md border shadow"
      />

      <Card className="w-full md:w-80">
        <CardHeader>
          <CardTitle>
            {selectedDay
              ? selectedDay.toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric"
                })
              : "Select a date"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedDay ? (
            selectedEvents.length ? (
              selectedEvents.map(ev => (
                <div key={ev.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Event</Badge>
                    <h4 className="font-medium leading-none">{ev.title}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {ev.description}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No events.</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a highlighted date to see details.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
