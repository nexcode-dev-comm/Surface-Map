import React, { useState } from 'react';
import './App.css';

function App() {
  // State to hold form input values
  const [formData, setFormData] = useState({
    name: '',
    surname: '',
    nickname: '',
    email: '',
    phone: '',
    age: ''
  });

  // State to hold the backend response
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Handle changes in input fields dynamically
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    // Prepare the payload (including real deletion paths for your buttons)
    const payload = {
      ...formData,
      age: parseInt(formData.age) || 0,
      found_platforms: [
        { 
          platform: "GitHub", 
          username: formData.nickname || "user", 
          profile_url: "https://github.com",
          delete_url: "https://github.com/settings/admin" 
        },
        { 
          platform: "LinkedIn", 
          username: `${formData.name} ${formData.surname}`, 
          profile_url: "https://linkedin.com",
          delete_url: "https://www.linkedin.com/help/linkedin/answer/a1376816/" 
        },
        { 
          platform: "Instagram", 
          username: formData.nickname || "user", 
          profile_url: "https://instagram.com",
          delete_url: "https://www.spotify.com/account/close-account/" 
        }
      ]
    };

    try {
      const response = await fetch('http://localhost:5000/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      setResults(data.found_platforms);
    } catch (error) {
      console.error('Error fetching data:', error);
      alert('Failed to connect to JSON Server. Make sure it is running on port 5000!');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <h2>Social Media Account Finder</h2>
      
      <div className="grid-container">
        {/* Form Section */}
        <form className="search-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>First Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Surname</label>
            <input type="text" name="surname" value={formData.surname} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Nickname</label>
            <input type="text" name="nickname" value={formData.nickname} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Phone Number</label>
            <input type="tel" name="phone" value={formData.phone} onChange={handleChange} required />
          </div>

          <div className="form-group">
            <label>Age</label>
            <input type="number" name="age" value={formData.age} onChange={handleChange} required />
          </div>

          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Find Accounts'}
          </button>
        </form>

        {/* Results Section */}
        <div className="results-section">
          <h3>Connected Accounts</h3>
          {results.length === 0 ? (
            <p className="no-data">No accounts found yet. Submit the form to test.</p>
          ) : (
            <div className="platform-list">
              {results.map((item, index) => (
                <div key={index} className="platform-card">
                  <h4>{item.platform}</h4>
                  <p>Username: <span>@{item.username}</span></p>
                  
                  {/* Action row layout holding both links together */}
                  <div className="card-actions">
                    <a href={item.profile_url} target="_blank" rel="noreferrer" className="profile-link">
                      View Profile
                    </a>

                    <a href={item.delete_url} target="_blank" rel="noreferrer" className="go-delete-btn">
                      ⚠️ Go Delete Account
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;