const fs = require('fs');
var axios = require('axios');
const { Cipher } = require('crypto');
const { start } = require('repl');

async function run() {
    var options = {
        headers: {"Content-Type": "blob"}
    }

    const cluster_properties_file_url = 'https://raw.githubusercontent.com/redpanda-data/redpanda/dev/src/v/config/configuration.h';
    
    const cluster_config_file_url = 'https://raw.githubusercontent.com/redpanda-data/redpanda/dev/src/v/config/configuration.cc';
    const node_config_file_url = 'https://raw.githubusercontent.com/redpanda-data/redpanda/dev/src/v/config/node_config.cc';

    var cluster_properties_file = await axios.get(cluster_properties_file_url, options);
    var cluster_config_file = await axios.get(cluster_config_file_url, options);
    var node_config_file = await axios.get(node_config_file_url, options);
    
    var arr = cluster_config_file.data.split('\n');
    var node_arr = node_config_file.data.split('\n');
    var started = false;

    var node_configs = [];
    var cluster_configs = [];
    var tunable_configs = [];
    var missing_info = [];

    var config_name_pos = -1; 
    var config_desc_pos = -1;
    var config_type_pos = -1;
    var config_default_value_pos = -1;

    const propertisTypes = loadClusterPropertiesTypes(cluster_properties_file);

    let config = {};

    const cluster_config_start_line = 'configuration::configuration()';
    const cluster_config_end_line = 'configuration::error_map_t';
    const node_config_start_line = 'node_config::node_config()';
    const node_config_end_line = 'node_config::error_map_t';

    for (var i = 0; i < arr.length; i++) {
        
        if (arr[i].startsWith(cluster_config_start_line)) {
            started = true;
        }

        if (arr[i].startsWith(cluster_config_end_line)) {
            break;
        }

        if (!started) {
            continue;
        }

        if (arr[i].endsWith('(')) {

            if (arr[i + 1].endsWith('(')) {
                continue;
            }

            config = {};
            config.isTunable = false;

            if (arr[i + 1].endsWith(')')) {

                let props = arr[i + 1].split(',');
                config.key = arr[i].replace(', ','').replace('(', '').trim();
                config.name = props[1].replace('"','').trim();
                config.name = config.name.replace('",','');
                config.description = '';
                config.defaultValue = '';

                if (config.isTunable) {
                    tunable_configs.push(config);
                } else {
                    cluster_configs.push(config);
                }

                continue;
            }

            config.key = arr[i].replace(', ','').replace('(', '').trim();
            config_name_pos = i + 2;
            config.name = arr[config_name_pos].replace('"','').trim();
            config.name = config.name.replace('",','');

            config_desc_pos = i + 3;
            config.description = '';
            if (arr[config_desc_pos].endsWith('",')) {
                config.description = arr[config_desc_pos].replace('"','').trim();
                config.description = config.description.replace('",','');
            } else {
                do {
                    config.description = config.description + ' ' + arr[config_desc_pos].replaceAll('"','').trim();
                    config_desc_pos++;
                }  while (!arr[config_desc_pos].endsWith('",'));
                config.description = config.description + ' ' + arr[config_desc_pos].replaceAll('"','').trim();
                config.description = config.description.replaceAll(',','');
            }
            
            config.description = config.description.trim();
            
            config_type_pos = config_desc_pos + 1;

            if (arr[config_type_pos].endsWith('},')) {
                if (arr[config_type_pos].includes('visibility::tunable')) {
                    config.isTunable = true;
                }
            } else {
                config_type_pos++;
                while (!arr[config_type_pos].endsWith('},')) {
                    config_type_pos++
                }

                if (arr[config_type_pos].includes('visibility::tunable')) {
                    config.isTunable = true;
                }
            }
            config.type = 'cluster';

            config_default_value_pos = config_type_pos + 1;

            if (arr[config_default_value_pos].includes(')')) {
                config.defaultValue = arr[config_default_value_pos].substring(0, arr[config_default_value_pos].lastIndexOf(')'));
                config.defaultValue = config.defaultValue.trim();
            } else {
                config.defaultValue = arr[config_default_value_pos].substring(0, arr[config_default_value_pos].indexOf(','));
                config.defaultValue = config.defaultValue.trim();

                config_default_value_pos++;
                console.log(arr[config_default_value_pos]);
                while (arr[config_default_value_pos]!=undefined && !arr[config_default_value_pos].endsWith(')')) {

                    if (arr[config_default_value_pos].includes('.min')) {
                        config.minValue = extractRangeValues(arr[config_default_value_pos]);
                    }

                    if (arr[config_default_value_pos].includes('.max')) {
                        config.maxValue = extractRangeValues(arr[config_default_value_pos]);                    
                    }

                    config_default_value_pos++;
                }    

                let ln = arr[config_default_value_pos];
                if(ln!=undefined){
                if (ln.includes('.min') &&
                        ln.includes('.max')) {
                    config.minValue = ln.substring(ln.indexOf('=') + 2, ln.indexOf(','));
                    config.maxValue = ln.substring(ln.lastIndexOf('=') + 2, ln.indexOf('}'));
                } else if (ln.includes('.min')) {
                    config.minValue = extractRangeValues(ln);
                } else if (ln.includes('.max')) {
                    config.maxValue = extractRangeValues(ln);
                }
            }
            }

            config.defaultValue = convertToBytes(config.defaultValue);
            config.defaultValue = extractValuesFromTypes(config.defaultValue, config.key, propertisTypes);
            config.minValue = convertToBytes(config.minValue);
            config.maxValue = convertToBytes(config.maxValue);

            if (config.description.trim().length === 0
                || !config.defaultValue
                || config.defaultValue.trim().length === 0) {
                missing_info.push(config);
            }

            if (config.isTunable) {
                tunable_configs.push(config);
            } else {
                cluster_configs.push(config);
            }

        }
        
        if (arr[i].includes("true) {}")) {
            break;
        }
    }

    for (var j = 0; j < node_arr.length; j++) {
        if (node_arr[j].startsWith(node_config_start_line)) {
            started = true;
        }

        if (node_arr[j].startsWith(node_config_end_line)) {
            break;
        }

        if (!started) {
            continue;
        }

        if (node_arr[j].endsWith('(')) {

            if (node_arr[j + 1].endsWith('(')) {
                continue;
            }

            config = {};
            config.isTunable = false;
            config_name_pos = j + 2;
            config.name = node_arr[config_name_pos].replace('"','').trim();
            config.name = config.name.replace('",','');

            config_desc_pos = j + 3;
            config.description = '';
            if (node_arr[config_desc_pos].endsWith('",')) {
                config.description = node_arr[config_desc_pos].replace('"','').trim();
                config.description = config.description.replace('",','');
            } else {
                do {
                    config.description = config.description + ' ' + node_arr[config_desc_pos].replaceAll('"','').trim();
                    config_desc_pos++;
                }  while (!node_arr[config_desc_pos].endsWith('",'));
                config.description = config.description + ' ' + node_arr[config_desc_pos].replaceAll('"','').trim();
                config.description = config.description.replaceAll(',','');
            }
            
            config.description = config.description.trim();
            
            config_type_pos = config_desc_pos + 1;

            if (node_arr[config_type_pos].endsWith('},')) {
                if (node_arr[config_type_pos].includes('visibility::tunable')) {
                    config.isTunable = true;
                }
            } else {
                config_type_pos++;
                while (node_arr[config_type_pos]!=undefined && !node_arr[config_type_pos].endsWith('},')) {
                    config_type_pos++
                }

                if (node_arr[config_type_pos]!=undefined && node_arr[config_type_pos].includes('visibility::tunable')) {
                    config.isTunable = true;
                }
            }
            config.type = 'node';

            config_default_value_pos = config_type_pos + 1;

            if(node_arr[config_default_value_pos]!=undefined){

            if (node_arr[config_default_value_pos].includes(')')) {
                config.defaultValue = node_arr[config_default_value_pos].substring(0, node_arr[config_default_value_pos].lastIndexOf(')'));
                config.defaultValue = config.defaultValue.trim();
            } else {
                config.defaultValue = node_arr[config_default_value_pos].substring(0, node_arr[config_default_value_pos].indexOf(','));
                config.defaultValue = config.defaultValue.trim();

                config_default_value_pos++;
                while (!node_arr[config_default_value_pos].endsWith(')')) {

                    if (node_arr[config_default_value_pos].includes('.min')) {
                        config.minValue = extractRangeValues(node_arr[config_default_value_pos]);
                    }

                    if (node_arr[config_default_value_pos].includes('.max')) {
                        config.maxValue = extractRangeValues(node_arr[config_default_value_pos]);                    
                    }

                    config_default_value_pos++;
                }    

                let ln = node_arr[config_default_value_pos];
                if (ln.includes('.min') &&
                        ln.includes('.max')) {
                    config.minValue = ln.substring(ln.indexOf('=') + 2, ln.indexOf(','));
                    config.maxValue = ln.substring(ln.lastIndexOf('=') + 2, ln.indexOf('}'));
                } else if (ln.includes('.min')) {
                    config.minValue = extractRangeValues(ln);
                } else if (ln.includes('.max')) {
                    config.maxValue = extractRangeValues(ln);
                }

            }
        }


            config.defaultValue = convertToBytes(config.defaultValue);
            config.defaultValue = extractValuesFromTypes(config.defaultValue, config.key, propertisTypes);
            config.minValue = convertToBytes(config.minValue);
            config.maxValue = convertToBytes(config.maxValue);

            if (config.description.trim().length === 0
                || !config.defaultValue
                || config.defaultValue.trim().length === 0) {
                missing_info.push(config);
            }

            if (config.isTunable) {
                tunable_configs.push(config);
            } else {
                node_configs.push(config);
            }
        }
    }

    cluster_configs.sort(compare);
    node_configs.sort(compare);
    tunable_configs.sort(compare);
    console.log('total node configs = ' + node_configs.length);
    console.log('total cluster configs = ' + cluster_configs.length);
    console.log('total tunable configs = ' + tunable_configs.length);

    writeFile('cluster_configs_table.txt', cluster_configs);
    writeFile('node_configs_table.txt', node_configs);
    writeFile('tunable_configs_table.txt', tunable_configs);
    writeFile('missing_info_table.txt', missing_info);
}

function loadClusterPropertiesTypes(file) {
    let arr = file.data.split('\n');
    let ln, k, v;
    let properties_map = new Map();
    for (var i = 0; i < arr.length; i++) {
        ln = arr[i];

        if (ln.includes('property')) {
            v = ln.substring(ln.indexOf('<') + 1, ln.lastIndexOf('>')).trim();
            if (ln.includes(';')) {
                k = ln.substring(ln.indexOf('> ') + 2, ln.indexOf(';')).trim();
            } else {
                let property_name_pos = i + 1;
                while (!arr[property_name_pos].includes(';')) {
                    property_name_pos++;
                }
                k = arr[property_name_pos].trim();
                k = arr[property_name_pos].substring(0, arr[property_name_pos].indexOf(';')).trim();
            }
            properties_map.set(k,v);
        }
    }
    return properties_map;
}

function extractValuesFromTypes(value, property_key, properties_types) {
    const milliseconds = 'chrono::milliseconds';
    const unresolved_address = 'net::unresolved_address';
    const deletion_bitflag = 'model::cleanup_policy_bitflags::deletion';
    const compression_producer = 'model::compression::producer';
    const create_time = 'model::timestamp_type::create_time';
    const crash_recovery_policy = 'model::violation_recovery_policy::crash';
    const raft_non_local_requests = 'default_raft_non_local_requests()';
    const nullopt = 'std::nullopt';

    let extractedValue = value;

    if(value!=undefined){
        if (value.includes(milliseconds)) {
            extractedValue = extractedValue.substring(extractedValue.indexOf('(') + 1);
            let lastPos =extractedValue.length;
            if (extractedValue.includes(')')) {
                lastPos = extractedValue.indexOf(')');
            }
            extractedValue = extractedValue.substring(0, lastPos);
            
            if (extractedValue.includes('s')) {
                extractedValue = extractedValue.substring(0, extractedValue.indexOf('s'));
                extractedValue = (parseInt(extractedValue) * 1000).toString();
            }
        }

        if (value.includes(unresolved_address)) {
            extractedValue = extractedValue.substring(extractedValue.lastIndexOf('(') + 1);
            let lastPos = extractedValue.length;
            if (extractedValue.includes(')')) {
                lastPos = extractedValue.indexOf(')');
            }
            extractedValue = extractedValue.substring(0, lastPos);
            extractedValue = extractedValue.replaceAll('"', '');
            extractedValue = extractedValue.replaceAll(', ', ':');
            extractedValue = extractedValue.replaceAll(',', ':');
        }

        if (value.includes(deletion_bitflag)) {
            extractedValue = '1';
        }
    

    if (extractedValue.includes(compression_producer)) { 
        extractedValue = '4294967295';
    }

    if (extractedValue.includes(create_time)) { 
        extractedValue = 'CreateTime';
    }

    if (extractedValue.includes(crash_recovery_policy)) { 
        extractedValue = '0';
    }

    if (extractedValue.includes(raft_non_local_requests)) { 
        extractedValue = 'The maximum number of x-core pending in Raft relies on the total number of cores that your environment is executing.';
    }

    if (extractedValue.includes(nullopt)) {
        extractedValue = 'Null';
    }

    if (extractedValue.includes('ms')) {
        if (extractedValue.includes('\'')) {
            extractedValue = extractedValue.replace('\'', '');
        }
        extractedValue = extractedValue.substring(0, extractedValue.indexOf('ms'));
    }

    if (extractedValue.includes('s')
        || extractedValue.includes('min')
        || extractedValue.includes('h')) {
            let propertyType = properties_types.get(property_key);
            if (propertyType === 'std::chrono::milliseconds') {
                
                if (extractedValue.includes('s')) {
                    extractedValue = parseInt(extractedValue.substring(0, extractedValue.indexOf('s')));
                    extractedValue *= 1000; 
                } else if (extractedValue.includes('min')) {
                    extractedValue = parseInt(extractedValue.substring(0, extractedValue.indexOf('min')));
                    extractedValue *= 60000; 
                } else if (extractedValue.includes('h')) {
                    extractedValue = parseInt(extractedValue.substring(0, extractedValue.indexOf('h')));
                    extractedValue *= 36000000; 
                }

                extractedValue = extractedValue.toString();
            }
    }

}

    return extractedValue
}

function convertToBytes(value) {

    if (typeof value === 'undefined') {
        return value;
    }

    if (!value.includes('GiB') && !value.includes('MiB') && !value.includes('KiB')) {
        return value;
    }

    let val = parseInt(value.split('_')[0]);
    let format = value.split('_')[1];
    
    let convertedValue = 0;

    if (format == 'MiB') {
        val *= 1;
        value = value.replace('_MiB', 'MB');
    }

    if (format == 'GiB') {
        val *= 1000;
        value = value.replace('_GiB', 'GB');
    }

    if (format == 'KiB') {
        val /= 1024;
        value = value.replace('_KiB', 'KB');
    }

    convertedValue = val * 1048576;

    return convertedValue + ' (' + value + ')';
}

function writeFile(file_name, configs) {

    let configs_content = '';

    for (var k = 0; k < configs.length; k++) {
        let cfg = configs[k];

        // Add property name as a header
        configs_content += '== ' + cfg.name + '\n\n';

        // Add property description
        configs_content += cfg.description;
        if (!configs_content.endsWith('.')) {
            configs_content += '.\n\n';
        } else {
            configs_content += '\n\n';
        }

        // Add additional details if they exist
        if (cfg.type) {
            configs_content += '*Type*: ' + cfg.type + '\n\n';
        }

        if (cfg.defaultValue !== undefined) {
            if (cfg.defaultValue.includes('"')) {
                configs_content += '*Default*: ' + cfg.defaultValue.replaceAll('"', '') + '\n\n';
            } else if (cfg.defaultValue.includes('{}')) {
                configs_content += '*Default*: Null' + '\n\n';
            } else {
                configs_content += '*Default*: ' + cfg.defaultValue + '\n\n';
            }
        }

        if (cfg.minValue) {
            configs_content += '*Minimum*: ' + cfg.minValue + '\n\n';
        }
        
        if (cfg.maxValue) {
            configs_content += '*Maximum*: ' + cfg.maxValue + '\n\n';
        }

        if (cfg.restartRequired) {
            configs_content += '*Restart required*: ' + (cfg.restartRequired ? 'yes' : 'no') + '\n\n';
        }

        // Add a line break after each configuration for readability
        configs_content += '\n';
    }

    fs.writeFile(file_name, configs_content, function(err) {
        if (err) {
            return console.log(err);
        }
    });
}

function extractRangeValues(line) {
    let value;

    if (line.includes(',')) {
        value = line.substring(line.indexOf('=') + 1, line.indexOf(','));
    } else if (line.includes('}')) {
        value = line.substring(line.indexOf('=') + 1, line.indexOf('}'));
    } else if (line.includes(' //')) {
        value = line.substring(line.indexOf('=') + 1, line.indexOf(' //'));
    }
    if (line.includes(', .align')) {
        value = line.substring(line.indexOf('=') + 1, line.indexOf(', .align'));
    }

    if (value.includes('::')) {
        value = value.substring(value.lastIndexOf('::') + 2, value.length);
    }

    return value.trim();
}

function compare( a, b ) {
    if ( a.name < b.name ){
      return -1;
    }
    if ( a.name > b.name ){
      return 1;
    }
    return 0;
  }

run()