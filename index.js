let jsonData = null;

async function fetchJSON() {
    try {
        const response = await fetch('./data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        console.log("JSON data loaded successfully.");
        return json;
    } catch (error) {
        console.error("Could not fetch JSON:", error);
        return null;
    }
}

function benchmarkStringSearchJS(data, searchTerm) {
    const results = [];
    const lowerSearchTerm = searchTerm.toLowerCase();
    Object.entries(data).forEach(([projectKey, projectValue]) => {
        let matchFoundInProject = false;
        if (projectKey.toLowerCase().includes(lowerSearchTerm)) {
            matchFoundInProject = true;
        }
        if (!matchFoundInProject && projectValue && typeof projectValue === 'object') {
            if (typeof projectValue.project === 'string' && projectValue.project.toLowerCase().includes(lowerSearchTerm)) {
                matchFoundInProject = true;
            }
            if (!matchFoundInProject && projectValue.benchmarks && typeof projectValue.benchmarks === 'object') {
                for (const [benchmarkKey, benchmarkValue] of Object.entries(projectValue.benchmarks)) {
                    if (benchmarkKey.toLowerCase().includes(lowerSearchTerm)) {
                        matchFoundInProject = true; break;
                    }
                    if (!matchFoundInProject && benchmarkValue && typeof benchmarkValue === 'object') {
                        if (typeof benchmarkValue.status === 'string' && benchmarkValue.status.toLowerCase().includes(lowerSearchTerm)) {
                            matchFoundInProject = true; break;
                        }
                        if (!matchFoundInProject && Array.isArray(benchmarkValue.samples)) {
                            for (const sampleObj of benchmarkValue.samples) {
                                if (sampleObj && typeof sampleObj.sample === 'string' && sampleObj.sample.toLowerCase().includes(lowerSearchTerm)) {
                                    matchFoundInProject = true; break;
                                }
                            }
                            if (matchFoundInProject) break;
                        }
                    }
                    if (matchFoundInProject) break;
                }
            }
        }
        if (matchFoundInProject) {
            if (!results.some(existing => existing === projectValue)) {
                 results.push(projectValue);
            }
        }
    });
    return results;
}

function filterCrashedBenchmarks(data, shouldCrash) {
    if (!data) return [];
    const crashValue = String(shouldCrash).toLowerCase() === 'true';

    const query = `values(@)[?length(benchmarks.*.samples[] | [?crashes == \`${crashValue}\`]) > \`0\`].benchmarks`;

    console.log(`Executing crash filter query: ${query}`);
    try {
        const results = jmespath.search(data, query);
        return Array.isArray(results) ? results : [];
    } catch (e) {
        console.error(`Error during JMESPath crash filter (value: ${crashValue}):`, e);
        return [];
    }
}

function filterBenchmarksByCoverage(data, threshold, operator = '>') {
    if (!data) return [];
    const numericThreshold = parseFloat(threshold);

    const validOperators = ['>', '<', '==', '>=', '<='];
    if (!validOperators.includes(operator)) {
        console.warn(`Invalid coverage operator: "${operator}". Using '>'.`);
        operator = '>';
    }

    const query = `values(@)[?length(benchmarks.*.samples[] | [?total_coverage ${operator} \`${numericThreshold}\`]) > \`0\`].benchmarks`;

    console.log(`Executing coverage filter query: ${query}`);
    try {
        const results = jmespath.search(data, query);
        return Array.isArray(results) ? results : [];
    } catch (e) {
        console.error(`Error during JMESPath coverage filter (threshold: ${numericThreshold}, operator: ${operator}):`, e);
        return [];
    }
}


function setupEventListeners() {
    const searchInput = document.getElementById('search');
    const crashFilterInput = document.getElementById('crashFilter');
    const covFilterInput = document.getElementById('covFilter');
    const searchButton = document.querySelector('button');

    if (!searchInput || !crashFilterInput || !covFilterInput || !searchButton) {
        console.error("One or more input elements or the button were not found!"); return;
    }

    searchButton.addEventListener('click', () => {
        if (!jsonData) {
            alert("Data is still loading or failed to load. Please try again."); return;
        }

        const searchTerm = searchInput.value.trim();
        const crashCriteria = crashFilterInput.value.trim();
        const covCriteria = covFilterInput.value.trim();

        let resultsToDisplay = [];
        let displayType = 'none'; // 'projects', 'benchmarks_list', 'none'

        const isCrashFilterActive = crashCriteria !== "";
        const isCovFilterActive = covCriteria !== "";

        if (isCrashFilterActive || isCovFilterActive) {
            displayType = 'benchmarks_list'; 
            let filteredBenchmarkObjects = [];

            if (isCrashFilterActive) {
                console.log(`Filtering by crash: "${crashCriteria}" (using JMESPath)`);
                filteredBenchmarkObjects = filterCrashedBenchmarks(jsonData, crashCriteria);

                if(isCovFilterActive) {
                   console.log(`Applying coverage filter > "${covCriteria}" to crash results (using JS)`);
                   const numericThreshold = parseFloat(covCriteria);
                   const operator = '>'; 
                   if (!isNaN(numericThreshold)){
                       const doublyFiltered = [];
                       filteredBenchmarkObjects.forEach(benchObj => {
                           const matchingEntries = Object.entries(benchObj).filter(([key, benchVal]) =>
                               benchVal.samples && benchVal.samples.some(sample => {
                                   switch(operator) {
                                       case '>': return sample.total_coverage > numericThreshold;
                                       case '<': return sample.total_coverage < numericThreshold;
                                       case '==': return sample.total_coverage == numericThreshold; 
                                       case '>=': return sample.total_coverage >= numericThreshold;
                                       case '<=': return sample.total_coverage <= numericThreshold;
                                       default: return false;
                                   }
                               })
                           );

                           if (matchingEntries.length > 0) {
                               doublyFiltered.push(Object.fromEntries(matchingEntries));
                           }
                       });
                       filteredBenchmarkObjects = doublyFiltered;
                   }
                }

            } else if (isCovFilterActive) {
                console.log(`Filtering by coverage > "${covCriteria}" (using JMESPath)`);
                filteredBenchmarkObjects = filterBenchmarksByCoverage(jsonData, covCriteria, '>');
            }

             console.log("Filtered results:", filteredBenchmarkObjects);
             resultsToDisplay = filteredBenchmarkObjects;

        } else if (searchTerm !== "") {
            // Only general search is active
             displayType = 'projects';
            console.log(`Searching for: "${searchTerm}"`);
            resultsToDisplay = benchmarkStringSearchJS(jsonData, searchTerm);
            console.log("General Search Results (Projects):", resultsToDisplay);

        } else {
            displayType = 'none';
            resultsToDisplay = [];
            console.log("No search terms or filters active.");
        }

        displayResults(resultsToDisplay, displayType);
    });
}


function displayResults(results, type = 'none') {
    const resultsContainer = document.getElementById('resultsDisplay');

    resultsContainer.innerHTML = '';

    if (type === 'none' || !results || !Array.isArray(results) || results.length === 0) {
        resultsContainer.textContent = 'No matching results found.';
        return;
    }
    const ul = document.createElement('ul');
    let itemsAdded = 0; 

    try {
        if (type === 'projects') {
            resultsContainer.innerHTML = '<h2>Matching Projects:</h2>'; 
            results.forEach((project, index) => {
                if (project && typeof project === 'object' && project.project) {
                    const li = document.createElement('li');
                    const pre = document.createElement('pre');
                    pre.textContent = JSON.stringify(project, null, 2);
                    li.textContent = `Project: ${project.project}`;
                    li.appendChild(pre);
                    ul.appendChild(li);
                    itemsAdded++;
                } 
            });

        } else if (type === 'benchmarks_list') {
            resultsContainer.innerHTML = '<h2>Matching Benchmarks:</h2>'; 
            results.forEach((projectBenchmarksObject, index) => {
                if (projectBenchmarksObject && typeof projectBenchmarksObject === 'object') {
                    Object.entries(projectBenchmarksObject).forEach(([benchmarkKey, benchmarkValue]) => {
                        const li = document.createElement('li');
                        const pre = document.createElement('pre');
                        pre.textContent = JSON.stringify(benchmarkValue, null, 2);
                        li.textContent = `Benchmark: ${benchmarkKey}`;
                        li.appendChild(pre);
                        ul.appendChild(li);
                        itemsAdded++;
                    });
                }
            });

        } else {
             resultsContainer.textContent = 'Invalid display type specified.';
             return;
        }

        if (itemsAdded > 0) {
            resultsContainer.appendChild(ul);
        } else {
            resultsContainer.textContent = 'No matching results found for the selected filters.';
        }

    } catch (error) {
        console.error("Error during displayResults:", error);
        resultsContainer.textContent = 'An error occurred while displaying results.';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM fully loaded and parsed");
    jsonData = await fetchJSON();
    if (jsonData) {
        setupEventListeners();
        if (!document.getElementById('resultsDisplay')) {
            const resultsDiv = document.createElement('div');
            resultsDiv.id = 'resultsDisplay';
            resultsDiv.style.marginTop = '20px';
            document.body.appendChild(resultsDiv);
        }
    } 
});