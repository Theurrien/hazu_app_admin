import React, { useEffect, useState } from 'react';
import { RoomCategorySelector } from './RoomCategorySelector';

interface CreatePersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPersonCreated: (person: any) => void;
  rooms: Array<{ id: string; title: string; room_type: string }>;
}

interface ProfileCategory {
  id: string;
  title: string;
  profileType: string;
}

interface ProfileTemplate {
  id: string;
  title: string;
}

type LoadingState = 'idle' | 'fetching' | 'loadingTemplates' | 'submitting';
type ErrorState = 'fetch' | 'fetchTemplates' | 'submit' | null;

const roleLabels: Record<string, string> = {
  student: 'Student',
  companymentor: 'Company Mentor',
  schoolteacher: 'School Teacher',
  courseteacher: 'Course Teacher',
  stateadvisor: 'State Advisor',
  guardian: 'Guardian',
};

export function CreatePersonModal({ isOpen, onClose, onPersonCreated, rooms }: CreatePersonModalProps) {
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [errorState, setErrorState] = useState<ErrorState>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [categories, setCategories] = useState<ProfileCategory[]>([]);
  const [templates, setTemplates] = useState<ProfileTemplate[]>([]);

  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [invitationMail, setInvitationMail] = useState<boolean>(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);

  // Fetch profile categories when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchCategories();
    } else {
      // Reset form when modal closes
      resetForm();
    }
  }, [isOpen]);

  // Fetch templates when role changes
  useEffect(() => {
    if (selectedRole) {
      fetchTemplates(selectedRole);
    } else {
      setTemplates([]);
      setSelectedTemplateId('');
    }
  }, [selectedRole]);

  // Auto-select template if only one option
  useEffect(() => {
    if (templates.length === 1 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates]);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setUserEmail('');
    setSelectedRole('');
    setSelectedTemplateId('');
    setInvitationMail(false);
    setSelectedRoomIds([]);
    setCategories([]);
    setTemplates([]);
    setErrorState(null);
    setErrorMessage('');
    setLoadingState('idle');
  };

  const fetchCategories = async () => {
    setLoadingState('fetching');
    setErrorState(null);

    try {
      const result = await window.electronAPI.fetchProfileCategories();

      if (result.success && result.categories) {
        setCategories(result.categories);
        setLoadingState('idle');
      } else {
        setErrorState('fetch');
        setErrorMessage(result.error || 'Failed to fetch profile categories');
        setLoadingState('idle');
      }
    } catch (error) {
      setErrorState('fetch');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setLoadingState('idle');
    }
  };

  const fetchTemplates = async (role: string) => {
    setLoadingState('loadingTemplates');
    setErrorState(null);

    try {
      const result = await window.electronAPI.fetchProfileTemplates(role);

      if (result.success && result.templates) {
        setTemplates(result.templates);
        setLoadingState('idle');
      } else {
        setErrorState('fetchTemplates');
        setErrorMessage(result.error || `No templates found for ${roleLabels[role] || role}`);
        setLoadingState('idle');
      }
    } catch (error) {
      setErrorState('fetchTemplates');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setLoadingState('idle');
    }
  };

  const findTargetIdForRole = (role: string): string | null => {
    // Find the category that matches this role
    const category = categories.find((cat) => cat.profileType === role);
    return category?.id || null;
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!firstName.trim()) {
      setErrorState('submit');
      setErrorMessage('First name is required');
      return;
    }

    if (!lastName.trim()) {
      setErrorState('submit');
      setErrorMessage('Last name is required');
      return;
    }

    if (!userEmail.trim()) {
      setErrorState('submit');
      setErrorMessage('Email is required');
      return;
    }

    if (!validateEmail(userEmail)) {
      setErrorState('submit');
      setErrorMessage('Please enter a valid email address');
      return;
    }

    if (!selectedRole) {
      setErrorState('submit');
      setErrorMessage('Please select a role');
      return;
    }

    if (!selectedTemplateId) {
      setErrorState('submit');
      setErrorMessage('Please select a template');
      return;
    }

    const targetId = findTargetIdForRole(selectedRole);
    if (!targetId) {
      setErrorState('submit');
      setErrorMessage(`No target location found for role: ${roleLabels[selectedRole] || selectedRole}`);
      return;
    }

    setLoadingState('submitting');
    setErrorState(null);

    try {
      const result = await window.electronAPI.createPerson({
        sourceId: selectedTemplateId,
        targetId: targetId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        userEmail: userEmail.trim(),
        role: selectedRole,
        roomIds: selectedRoomIds,
        invitationMail: invitationMail,
      });

      if (result.success && result.person) {
        // Success - call callback and close modal
        onPersonCreated(result.person);
        onClose();
        resetForm();
      } else {
        setErrorState('submit');
        setErrorMessage(result.error || 'Failed to create person');
        setLoadingState('idle');
      }
    } catch (error) {
      setErrorState('submit');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setLoadingState('idle');
    }
  };

  const canSubmit =
    firstName.trim() &&
    lastName.trim() &&
    userEmail.trim() &&
    validateEmail(userEmail) &&
    selectedRole &&
    selectedTemplateId &&
    loadingState !== 'submitting';

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">Create New Person</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={loadingState === 'submitting'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Loading state while fetching categories */}
          {loadingState === 'fetching' && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3 text-gray-600">
                <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span>Loading profile categories...</span>
              </div>
            </div>
          )}

          {/* Fetch error state */}
          {errorState === 'fetch' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-red-800">{errorMessage}</p>
                  <button
                    type="button"
                    onClick={fetchCategories}
                    className="mt-2 text-sm text-red-700 hover:text-red-900 font-medium"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Form content - only show if not fetching and no fetch error */}
          {loadingState !== 'fetching' && errorState !== 'fetch' && (
            <>
              {/* Name and Email Row */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="John"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loadingState === 'submitting'}
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loadingState === 'submitting'}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    E-Mail <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="john@example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loadingState === 'submitting'}
                  />
                </div>
              </div>

              {/* Role Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Role <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <label
                      key={role}
                      className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedRole === role
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={role}
                        checked={selectedRole === role}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        className="w-4 h-4 text-blue-600"
                        disabled={loadingState === 'submitting'}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Template Selection - only show after role is selected */}
              {selectedRole && (
                <div>
                  <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-2">
                    Template <span className="text-red-500">*</span>
                  </label>

                  {/* Loading templates */}
                  {loadingState === 'loadingTemplates' && (
                    <div className="flex items-center gap-2 text-gray-600 py-2">
                      <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      <span className="text-sm">Loading templates...</span>
                    </div>
                  )}

                  {/* Template fetch error */}
                  {errorState === 'fetchTemplates' && (
                    <div className="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">
                      {errorMessage}
                    </div>
                  )}

                  {/* Template dropdown */}
                  {loadingState !== 'loadingTemplates' && errorState !== 'fetchTemplates' && (
                    <>
                      {templates.length === 0 ? (
                        <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">
                          No templates available for {roleLabels[selectedRole]}
                        </div>
                      ) : (
                        <select
                          id="template"
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={loadingState === 'submitting'}
                        >
                          {templates.length > 1 && <option value="">Select template...</option>}
                          {templates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Invitation Email Checkbox */}
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={invitationMail}
                    onChange={(e) => setInvitationMail(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    disabled={loadingState === 'submitting'}
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Send invitation email
                  </span>
                </label>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200"></div>

              {/* Room Assignments */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Rooms (optional)
                </label>
                <RoomCategorySelector
                  rooms={rooms}
                  selectedRoomIds={selectedRoomIds}
                  onChange={setSelectedRoomIds}
                />
              </div>

              {/* Submit error state */}
              {errorState === 'submit' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-800">{errorMessage}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Footer buttons */}
          {loadingState !== 'fetching' && errorState !== 'fetch' && (
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={loadingState === 'submitting'}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  canSubmit
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {loadingState === 'submitting' && (
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                )}
                Create Person
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
