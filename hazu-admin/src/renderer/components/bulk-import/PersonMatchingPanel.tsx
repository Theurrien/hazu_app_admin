import React, { useState, useMemo } from 'react';

interface Person {
  id: string;
  email: string | null;
  display_name: string;
}

interface PersonMatchingPanelProps {
  emails: string[];
  persons: Person[];
  personMatches: Map<string, string | null>;
  personResolutions: Map<string, string>;
  onResolutionChange: (email: string, personId: string | null) => void;
}

export function PersonMatchingPanel({
  emails,
  persons,
  personMatches,
  personResolutions,
  onResolutionChange,
}: PersonMatchingPanelProps) {
  const [searchQueries, setSearchQueries] = useState<Map<string, string>>(new Map());

  // Count matched and unmatched
  const { matchedCount, unmatchedEmails } = useMemo(() => {
    let matched = 0;
    const unmatched: string[] = [];

    emails.forEach((email) => {
      const autoMatch = personMatches.get(email);
      const manualMatch = personResolutions.get(email);

      if (autoMatch || manualMatch) {
        matched++;
      } else {
        unmatched.push(email);
      }
    });

    return { matchedCount: matched, unmatchedEmails: unmatched };
  }, [emails, personMatches, personResolutions]);

  // Get persons that are not yet matched (for dropdown options)
  const getAvailablePersons = (excludeEmail: string) => {
    const usedPersonIds = new Set<string>();

    emails.forEach((email) => {
      if (email === excludeEmail) return;

      const autoMatch = personMatches.get(email);
      const manualMatch = personResolutions.get(email);
      if (autoMatch) usedPersonIds.add(autoMatch);
      if (manualMatch) usedPersonIds.add(manualMatch);
    });

    return persons.filter((p) => !usedPersonIds.has(p.id));
  };

  // Filter persons by search query
  const filterPersons = (availablePersons: Person[], query: string) => {
    if (!query.trim()) return availablePersons.slice(0, 50); // Limit to 50

    const lowerQuery = query.toLowerCase();
    return availablePersons
      .filter(
        (p) =>
          p.display_name.toLowerCase().includes(lowerQuery) ||
          p.email?.toLowerCase().includes(lowerQuery)
      )
      .slice(0, 50);
  };

  const handleSearchChange = (email: string, query: string) => {
    setSearchQueries((prev) => new Map(prev).set(email, query));
  };

  const handleSelectPerson = (email: string, personId: string) => {
    onResolutionChange(email, personId);
    setSearchQueries((prev) => {
      const next = new Map(prev);
      next.delete(email);
      return next;
    });
  };

  if (emails.length === 0) {
    return null;
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-300 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Person Matching</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-600">✓ {matchedCount} matched</span>
          {unmatchedEmails.length > 0 && (
            <span className="text-yellow-600">⚠ {unmatchedEmails.length} unmatched</span>
          )}
        </div>
      </div>

      {/* Unmatched list */}
      {unmatchedEmails.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          <div className="divide-y divide-gray-200">
            {unmatchedEmails.map((email) => {
              const searchQuery = searchQueries.get(email) || '';
              const availablePersons = getAvailablePersons(email);
              const filteredPersons = filterPersons(availablePersons, searchQuery);
              const currentResolution = personResolutions.get(email);

              return (
                <div key={email} className="px-4 py-3">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {email}
                      </div>
                      <div className="text-xs text-red-500">No match found</div>
                    </div>

                    <div className="flex-1">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search person..."
                          value={currentResolution ? '' : searchQuery}
                          onChange={(e) => handleSearchChange(email, e.target.value)}
                          disabled={!!currentResolution}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                        />

                        {/* Search results dropdown */}
                        {searchQuery && !currentResolution && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {filteredPersons.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-500">
                                No persons found
                              </div>
                            ) : (
                              filteredPersons.map((person) => (
                                <button
                                  key={person.id}
                                  type="button"
                                  onClick={() => handleSelectPerson(email, person.id)}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100"
                                >
                                  <div className="font-medium">{person.display_name}</div>
                                  {person.email && (
                                    <div className="text-xs text-gray-500">{person.email}</div>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* Show selected resolution */}
                      {currentResolution && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-sm text-green-600">
                            → {persons.find((p) => p.id === currentResolution)?.display_name}
                          </span>
                          <button
                            type="button"
                            onClick={() => onResolutionChange(email, null)}
                            className="text-xs text-gray-500 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All matched message */}
      {unmatchedEmails.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-green-600">
          All emails matched successfully!
        </div>
      )}
    </div>
  );
}
